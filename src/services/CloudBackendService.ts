/**
 * CloudBackendService - Connects the frontend to Google Cloud Run backend
 * This service handles communication with the deployed Gemini API backend
 */

export interface CloudBackendConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  message: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
}

export interface ImageGenerationResponse {
  image_data: string;
  text?: string;
  error?: string;
}

export interface SearchRequest {
  query: string;
}

export interface SearchResponse {
  message: string;
  sources?: string[];
  error?: string;
}

export interface CodeExecutionRequest {
  code: string;
  language?: string;
}

export interface CodeExecutionResponse {
  message: string;
  execution_result?: any;
  error?: string;
}

export class CloudBackendService {
  private config: CloudBackendConfig;
  private baseUrl: string;

  constructor(config?: Partial<CloudBackendConfig>) {
    // Default to environment variable or fallback URL
    const defaultBaseUrl = process.env.REACT_APP_BACKEND_URL || 
                          'https://kb-in-line-citations-backend.onrender.com'; // Updated URL for Render deployment
    
    this.config = {
      baseUrl: defaultBaseUrl,
      timeout: 30000,
      retries: 3,
      ...config
    };
    
    this.baseUrl = this.config.baseUrl;
  }

  /**
   * Check if the backend service is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.request('/health', {
        method: 'GET',
        timeout: 5000
      });
      return response.status === 'healthy';
    } catch (error) {
      console.error('Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Get available models from the backend
   */
  async getModels(): Promise<any[]> {
    try {
      const response = await this.request('/api/models');
      return response.models || [];
    } catch (error) {
      console.error('Failed to get models:', error);
      return [];
    }
  }

  /**
   * Send chat message to the backend
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response;
    } catch (error) {
      console.error('Chat request failed:', error);
      return {
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Stream chat response from the backend
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    try {
      const streamRequest = { ...request, stream: true };
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(streamRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data.trim()) {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.text) {
                    yield parsed.text;
                  } else if (parsed.done) {
                    return;
                  } else if (parsed.error) {
                    throw new Error(parsed.error);
                  }
                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', data);
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Stream chat failed:', error);
      throw error;
    }
  }

  /**
   * Generate image using the backend
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    try {
      const response = await this.request('/api/generate-image', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response;
    } catch (error) {
      console.error('Image generation failed:', error);
      return {
        image_data: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Search with grounding using the backend
   */
  async searchWithGrounding(request: SearchRequest): Promise<SearchResponse> {
    try {
      const response = await this.request('/api/search', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response;
    } catch (error) {
      console.error('Search with grounding failed:', error);
      return {
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Execute code using the backend
   */
  async executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResponse> {
    try {
      const response = await this.request('/api/execute-code', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      return response;
    } catch (error) {
      console.error('Code execution failed:', error);
      return {
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generic request method with retry logic
   */
  private async request(
    endpoint: string, 
    options: RequestInit & { timeout?: number } = {}
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const timeout = options.timeout || this.config.timeout || 30000;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Update the backend URL
   */
  updateBackendUrl(newUrl: string): void {
    this.config.baseUrl = newUrl;
    this.baseUrl = newUrl;
  }

  /**
   * Get current backend URL
   */
  getBackendUrl(): string {
    return this.baseUrl;
  }
}

export default CloudBackendService; 