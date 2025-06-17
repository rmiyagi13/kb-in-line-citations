import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConversationTemplate, Message, Conversation } from '../types/index';
import { ConversationManager } from '../services/ConversationManager';
import { ModelManager } from '../services/ModelManager';
import { PDFProcessor } from '../utils/pdfProcessor';
import AIServiceRouter from '../services/AIServiceRouter';
import { estimateTokenCount } from '../utils/tokenCounter';
import { EnhancedRAGProcessor } from '../utils/enhancedRAG';
// import { OpenAIVoiceService } from '../services/OpenAIVoiceService';
// import { AvatarTTSService } from '../services/AvatarTTSService';
import LocalTTSService from '../services/LocalTTSService';
import LocalEnvironmentBuilder from './LocalEnvironmentBuilder';
import LocalServerManager from './LocalServerManager';
import { getUnifiedTTS } from '../services/UnifiedTTSService';
import TokenUsagePreview from './TokenUsagePreview';
import NotificationSystem, { Notification } from './NotificationSystem';
import ModelSwitcher from './ModelSwitcher';
import ProgressiveThinkingIndicator from './ProgressiveThinkingIndicator';
import CitationRenderer from './CitationRenderer';
import InlineRAGControls from './InlineRAGControls';
import HighlightedText from './HighlightedText';
import RAGDiscoveryPanel from './RAGDiscoveryPanel';
import { convertRAGResultsToCitations, filterAndRankCitations, createRAGDiscovery, parseTextWithHighlighting } from '../utils/citationParser';
import { IncantationEngine } from '../services/IncantationEngine';
import CodeSuggestion from './CodeSuggestion';
import IncantationButton from './IncantationButton';
import { AvatarInterface } from './AvatarInterface';
import InlineCitation from './InlineCitation';


// import { contextManager } from '../utils/contextManager'; // TODO: Implement context management

interface ConversationViewProps {
  conversation: Conversation;
  template: ConversationTemplate;
  conversationManager: ConversationManager;
  modelManager: ModelManager;
  onConversationUpdate: () => void;
}

interface PDFDocument {
  id: string;
  name: string;
  content: string;
  pages: number;
  size: number;
  pageCount: number;
  uploadedAt: Date;
  tokenCount: number;
}

interface VoiceStatus {
  isListening: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  error: string | null;
}

// Helper function to determine if a query warrants RAG search
const isSubstantialQuery = (query: string): boolean => {
  const trimmed = query.trim().toLowerCase();
  
  // Skip very short queries
  if (trimmed.length < 3) return false;
  
  // Common greetings and simple responses
  const simplePatterns = [
    /^(hi|hey|hello|yo)$/,
    /^(thanks?|thank you|ty)$/,
    /^(ok|okay|yes|no|sure)$/,
    /^(bye|goodbye|cya|see ya)$/,
    /^(how are you|what's up|wassup)$/,
    /^(good|great|nice|cool)$/
  ];
  
  return !simplePatterns.some(pattern => pattern.test(trimmed));
};

const ConversationView: React.FC<ConversationViewProps> = ({
  conversation,
  template,
  conversationManager,
  modelManager,
  onConversationUpdate
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pdfs, setPdfs] = useState<PDFDocument[]>(() => {
    // Load PDFs from localStorage on component mount
    try {
      const stored = localStorage.getItem(`pdfs-${conversation.id}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('Failed to load PDFs from localStorage:', error);
      return [];
    }
  });
  const [isProcessingPDF, setIsProcessingPDF] = useState(false);
  const [ragContext, setRagContext] = useState('');
  const [ragProcessor] = useState(() => new EnhancedRAGProcessor());
  const [isRateLimited, setIsRateLimited] = useState(false);
  // const [rateLimitReset, setRateLimitReset] = useState<Date | null>(null); // TODO: Implement rate limiting
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({
    isListening: false,
    isRecording: false,
    isSpeaking: false,
    error: null
  });
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentModelId, setCurrentModelId] = useState(template.modelId);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>('silky-smooth');
  const [currentCitations, setCurrentCitations] = useState<any[]>([]);
  const [ragDiscoveries, setRagDiscoveries] = useState<any[]>([]);
  const [incantationEngine] = useState(() => new IncantationEngine());

  const [workingDirectory, setWorkingDirectory] = useState('/Users/danielennis/ai-apps/rate limit message');
  
  // Persona-specific voice mapping
  const getPersonaVoice = (templateId: string, personaName: string): string => {
    const personaMappings: Record<string, string> = {
      'michael-crow': 'michael-crow',        // Southern authority
      'elizabeth-reilley': 'elizabeth-reilley', // Leadership vision
      'zohair': 'zohair-developer',          // Introverted genius
      'jennifer-werner': 'jennifer-tutor',    // Excited tutor
    };
    
    // Check persona name first
    const lowerPersona = personaName.toLowerCase();
    for (const [key, voice] of Object.entries(personaMappings)) {
      if (lowerPersona.includes(key.replace('-', ' '))) {
        return voice;
      }
    }
    
    // Template-based mapping
    if (templateId === 'llama-local' || templateId.includes('llama')) {
      return 'silky-smooth'; // Default for Llama models
    }
    
    return 'silky-smooth'; // Default fallback
  };
  
  const [selectedBrowserVoice, setSelectedBrowserVoice] = useState<string>('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiService = useMemo(() => new AIServiceRouter(), []);
  
  // Enhanced Avatar TTS service for Virtual Avatar Builder
  // const avatarTTSService = useRef<AvatarTTSService | null>(null);
  const localTTSService = useRef<LocalTTSService | null>(null);
  
  // Voice recognition setup
  const recognition = useRef<SpeechRecognition | null>(null);
  const synthesis = useRef<SpeechSynthesis | null>(null);

  // Check if running in demo mode (GitHub Pages without API keys)
  const isDemoMode = !process.env.REACT_APP_GEMINI_API_KEY && !process.env.REACT_APP_OPENAI_API_KEY;

  useEffect(() => {
    // Initialize Local TTS service for Virtual Avatar Builder
    if (template.id === 'virtual-avatar-builder') {
      // Initialize local TTS service (no API key needed!)
      localTTSService.current = new LocalTTSService({ model: 'enhanced-system' });
      console.log('🎭 Local TTS Service initialized for Virtual Avatar Builder');
      
      // Initialize local TTS in background
      localTTSService.current.initialize().catch(error => {
        console.warn('⚠️ Local TTS initialization failed, will use browser TTS:', error);
      });
    }
    
    // Always initialize local TTS for better voice quality
    if (!localTTSService.current) {
      localTTSService.current = new LocalTTSService({ model: 'enhanced-system' });
      localTTSService.current.initialize().catch(error => {
        console.warn('⚠️ Local TTS initialization failed, will use browser TTS:', error);
      });
    }
    
    // Auto-select persona voice based on template
    const autoVoice = getPersonaVoice(template.id, template.persona);
    if (autoVoice !== selectedVoice) {
      setSelectedVoice(autoVoice);
      console.log(`🎭 Auto-selected voice: ${autoVoice} for ${template.persona}`);
    }

    // Initialize voice services
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition.current = new SpeechRecognition();
      recognition.current.continuous = false;
      recognition.current.interimResults = false;
      recognition.current.lang = 'en-US';
      
      recognition.current.onstart = () => {
        setVoiceStatus(prev => ({ ...prev, isListening: true, isRecording: true, error: null }));
      };
      
      recognition.current.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setVoiceStatus(prev => ({ ...prev, isListening: false, isRecording: false }));
      };
      
      recognition.current.onerror = (event: SpeechRecognitionErrorEvent) => {
        setVoiceStatus(prev => ({ 
          ...prev, 
          isListening: false, 
          isRecording: false, 
          error: `Voice recognition error: ${event.error}` 
        }));
      };
      
      recognition.current.onend = () => {
        setVoiceStatus(prev => ({ ...prev, isListening: false, isRecording: false }));
      };
    }
    
    if ('speechSynthesis' in window) {
      synthesis.current = window.speechSynthesis;
      
      // Load available browser voices
      const loadVoices = () => {
        const voices = synthesis.current!.getVoices();
        
        // Set default browser voice to first English voice
        const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        if (defaultVoice) {
          setSelectedBrowserVoice(defaultVoice.name);
        }
      };
      
      // Load voices immediately and on change
      loadVoices();
      synthesis.current.onvoiceschanged = loadVoices;
    }
    
    setIsVoiceEnabled(!!recognition.current && !!synthesis.current);
  }, [selectedVoice, template.id, template.persona]);

  // Add notification helper functions
  const addNotification = (notification: Omit<Notification, 'id'>) => {
    const newNotification = {
      ...notification,
      id: Date.now().toString()
    };
    setNotifications(prev => [...prev, newNotification]);
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleModelSwitch = (newModelId: string) => {
    setCurrentModelId(newModelId);
    addNotification({
      type: 'info',
      title: 'Model Switched',
      message: `Now using ${modelManager.getAllModels().find(m => m.id === newModelId)?.name || newModelId}`,
      duration: 3000
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation.messages]);

  // Save PDFs to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(`pdfs-${conversation.id}`, JSON.stringify(pdfs));
      console.log(`💾 Saved ${pdfs.length} PDFs to localStorage for conversation ${conversation.id}`);
    } catch (error) {
      console.warn('Failed to save PDFs to localStorage:', error);
    }
  }, [pdfs, conversation.id]);

  // Load existing PDFs into RAG processor on mount
  useEffect(() => {
    if (pdfs.length > 0) {
      console.log(`📄 Loading ${pdfs.length} PDFs into RAG processor`);
      pdfs.forEach(pdf => {
        // Add to RAG processor if not already there
        const existingDocs = ragProcessor.getDocuments();
        if (!existingDocs.find(doc => doc.id === pdf.id)) {
          // Convert to processFile format for consistency  
          const fileBlob = new File([pdf.content], pdf.name, { type: 'application/pdf' });
          ragProcessor.processFile(fileBlob).catch(error => {
            console.warn(`Failed to re-process PDF ${pdf.name}:`, error);
          });
        }
      });
      
      // Update RAG context
      const combinedContext = pdfs.map(pdf => pdf.content).join('\n\n');
      setRagContext(combinedContext);
      console.log(`📚 RAG processor loaded with ${ragProcessor.getDocuments().length} documents`);
    }
  }, []); // Only run on mount

  useEffect(() => {
    // Rate limiting logic
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    const recentRequests = conversation.messages.filter(msg => 
      msg.role === 'user' && msg.timestamp > oneMinuteAgo
    ).length;
    
    if (recentRequests >= 15) {
      setIsRateLimited(true);
      // setRateLimitReset(new Date(now.getTime() + 60000)); // TODO: Implement rate limiting
    } else {
      setIsRateLimited(false);
      // setRateLimitReset(null); // TODO: Implement rate limiting
    }
  }, [conversation.messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const startVoiceRecognition = () => {
    if (recognition.current && !voiceStatus.isListening) {
      try {
        recognition.current.start();
      } catch (error) {
        setVoiceStatus(prev => ({ 
          ...prev, 
          error: 'Failed to start voice recognition' 
        }));
      }
    }
  };

  const stopVoiceRecognition = () => {
    if (recognition.current && voiceStatus.isListening) {
      recognition.current.stop();
    }
  };

  const speakText = async (text: string, isAIResponse: boolean = false) => {
    if (!text.trim()) return;

    // Stop any existing speech
    const unifiedTTS = getUnifiedTTS();
    unifiedTTS.stopSpeaking();

    try {
      setVoiceStatus(prev => ({ ...prev, isSpeaking: true, error: null }));
      
      // Add diagnostic logging
      const status = unifiedTTS.getStatus();
      console.log('🔊 TTS Status:', status);
      
      let result;
      
      if (selectedVoice === 'browser') {
        // Use browser TTS with specific voice
        const voiceConfig = {
          preferredVoice: 'auto' as const,
          fallbackVoice: selectedBrowserVoice,
          forceMode: 'browser' as const,
          speed: 1.0
        };
        
        if (isAIResponse) {
          console.log(`🎙️ ${template.persona}: Speaking AI response with browser voice...`);
          result = await unifiedTTS.speak(text, voiceConfig);
        } else {
          console.log(`🎙️ ${template.persona}: Speaking user feedback with browser voice...`);
          result = await unifiedTTS.speak(text, voiceConfig);
        }
      } else {
        // Use Enhanced System TTS with specific voice profile
        console.log(`🎙️ ${template.persona}: Speaking with ${selectedVoice} voice...`);
        console.log(`🔊 Enhanced TTS Available: ${status.barkAvailable}, Initializing: ${status.isInitializing}`);
        
        // Use LocalTTSService directly for precise voice control
        const localTTS = localTTSService.current;
        console.log(`🎭 Voice Selection Debug: ${selectedVoice}`);
        console.log(`🔊 Enhanced TTS Status: available=${status.barkAvailable}, initializing=${status.isInitializing}`);
        
        if (localTTS && status.barkAvailable) {
          try {
            console.log(`🎯 Calling generateSpeech with voice profile: ${selectedVoice}`);
            const localResult = await localTTS.generateSpeech(text, selectedVoice);
            
            console.log(`🎵 Generated audio with: ${localResult.metadata.voiceId} (${localResult.metadata.model})`);
            
            // Show notification about which voice is being used
            const voiceName = selectedVoice.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (localResult.metadata.model === 'enhanced-system') {
              addNotification({
                title: 'Voice Selection',
                message: `🎵 Using Enhanced System TTS: ${voiceName} (${localResult.metadata.voiceId})`,
                type: 'success',
                duration: 3000
              });
            } else if (localResult.metadata.model.includes('enhanced')) {
              addNotification({
                title: 'Voice Selection',
                message: `🎭 Using enhanced ${voiceName} voice simulation`,
                type: 'info',
                duration: 3000
              });
            } else if (localResult.metadata.model.includes('fallback')) {
              addNotification({
                title: 'Voice Selection',
                message: `🔧 Using fallback ${voiceName} voice`,
                type: 'warning',
                duration: 3000
              });
            } else {
              addNotification({
                title: 'Voice Selection',
                message: `🔊 Using ${voiceName} voice`,
                type: 'success',
                duration: 2000
              });
            }
            
            // Validate and play the audio
            if (localResult.audioUrl && localResult.audioBlob && localResult.audioBlob.size > 0) {
              const audio = new Audio(localResult.audioUrl);
              
              // Add error handling for audio playback
              audio.onerror = (error) => {
                console.error('🚨 Audio playback failed:', error);
                addNotification({
                  type: 'error',
                  title: 'Audio Error',
                  message: 'Failed to play generated audio',
                  duration: 3000
                });
              };
              
              // Add successful load handler
              audio.onloadeddata = () => {
                console.log('✅ Audio loaded successfully, duration:', audio.duration);
              };
              
              try {
                await audio.play();
                console.log('🎵 Audio playback started successfully');
              } catch (playError) {
                console.error('🚨 Audio play() failed:', playError);
                addNotification({
                  type: 'error',
                  title: 'Playback Error', 
                  message: 'Could not start audio playback',
                  duration: 3000
                });
              }
            } else {
              console.error('❌ Invalid audio data - missing URL or empty blob');
              throw new Error('Invalid audio data generated');
            }
            
            result = {
              success: true,
              audioUrl: localResult.audioUrl,
              audioBlob: localResult.audioBlob,
              method: 'enhanced-system' as const,
              metadata: {
                duration: localResult.metadata.duration,
                model: 'enhanced-system',
                voiceId: localResult.metadata.voiceId
              }
            };
          } catch (error) {
            console.warn('🎵 Enhanced System TTS failed, using fallback:', error);
            // Fallback to unified TTS
            result = await unifiedTTS.speak(text, { 
              preferredVoice: 'auto' as const,
              forceMode: 'auto' as const,
              speed: 1.0 
            });
          }
        } else {
          console.warn(`🚫 Enhanced TTS not available: localTTS=${!!localTTS}, enhancedAvailable=${status.barkAvailable}`);
          // Enhanced TTS not available, use unified TTS
          result = await unifiedTTS.speak(text, { 
            preferredVoice: 'auto' as const,
            forceMode: 'auto' as const,
            speed: 1.0 
          });
        }
      }

      // Log the method used for transparency
      if (result.method === 'enhanced-system') {
        console.log(`🎵 Using high-quality Enhanced System TTS with ${result.metadata?.voiceId} voice`);
        addNotification({
          type: 'success',
          title: 'Enhanced Voice',
          message: `Using Enhanced ${selectedVoice} voice`,
          duration: 2000
        });
      } else if (result.method === 'browser') {
        console.log(`🔊 Using browser TTS with ${result.metadata?.voiceId} voice`);
        addNotification({
          type: 'info',
          title: 'Browser Voice',
          message: `Using ${selectedBrowserVoice || 'system'} voice`,
          duration: 2000
        });
      } else {
        console.warn('⚠️ TTS failed:', result.error);
        addNotification({
          type: 'error',
          title: 'Voice Error',
          message: result.error || 'TTS failed',
          duration: 3000
        });
      }

      if (!result.success) {
        throw new Error(result.error || 'TTS failed');
      }

      // Handle speech completion
      const duration = result.metadata?.duration ? result.metadata.duration * 1000 : text.length * 100;
      setTimeout(() => {
        setVoiceStatus(prev => ({ ...prev, isSpeaking: false }));
        console.log(`✅ ${template.persona}: Finished speaking`);
      }, duration);

    } catch (error) {
      console.error('🚨 Enhanced TTS failed:', error);
      setVoiceStatus(prev => ({ 
        ...prev, 
        isSpeaking: false, 
        error: 'Voice synthesis failed' 
      }));
      
      addNotification({
        type: 'error',
        title: 'Voice Error',
        message: 'Voice synthesis failed',
        duration: 3000
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isRateLimited) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
      tokens: estimateTokenCount(input.trim())
    };

    // Add user message
    conversationManager.addMessage(conversation.id, userMessage);
    const originalInput = input.trim();
    setInput('');
    setIsLoading(true);
    onConversationUpdate();

    try {
      // Prepare context with recent messages
      const recentMessages = conversation.messages.slice(-10);
      const llamaMessages = recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      // Add current message
      llamaMessages.push({ role: 'user', content: originalInput });

      // Intelligent RAG retrieval with incantation tracking
      let intelligentRagContext = '';
      const shouldUseRAG = ragEnabled && ragProcessor.getDocuments().length > 0 && isSubstantialQuery(originalInput);
      
      if (shouldUseRAG) {
        console.log(`🔍 RAG Search: Looking for "${originalInput}" in ${ragProcessor.getDocuments().length} documents`);
        
        // Determine best incantation pattern for this query
        const recommendedPatterns = incantationEngine.recommendPatterns('document-search', originalInput);
        const selectedIncantation = recommendedPatterns[0] || 'semantic-search';
        
        console.log(`🎯 Using incantation: ${selectedIncantation}`);
        
        const ragResults = ragProcessor.searchDocuments({
          query: originalInput,
          maxResults: 5,
          minRelevanceScore: 0.05 // Much lower threshold for better recall
        });
        
        console.log(`🔍 RAG Results: Found ${ragResults.length} relevant chunks`);
        ragResults.forEach((result, i) => {
          console.log(`  ${i+1}. ${result.document.name} (${(result.relevanceScore * 100).toFixed(1)}%): ${result.context.substring(0, 100)}...`);
        });
        
        if (ragResults.length > 0) {
          // Convert RAG results to citations with incantation tracking
          const ragCitations = convertRAGResultsToCitations(ragResults, selectedIncantation);
          const qualityCitations = filterAndRankCitations(ragCitations, 0.2, 5);
          setCurrentCitations(qualityCitations);
          
          // Create RAG discovery record
          const discovery = createRAGDiscovery(
            originalInput,
            selectedIncantation,
            qualityCitations,
            intelligentRagContext
          );
          setRagDiscoveries(prev => [...prev, discovery]);
          
          intelligentRagContext = ragResults
            .map((result, index) => {
              const relevanceInfo = ` (${(result.relevanceScore * 100).toFixed(0)}% relevant)`;
              const chunkInfo = result.chunk.type !== 'paragraph' ? ` - ${result.chunk.type}` : '';
              return `**[Source: ${result.document.name}${chunkInfo}${relevanceInfo}]**\n\n${result.context}`;
            })
            .join('\n\n---\n\n');
          
          console.log(`🔍 RAG Context Length: ${intelligentRagContext.length} characters`);
          console.log(`🔗 Generated ${qualityCitations.length} citations from RAG results`);
          console.log(`🎯 Discovery recorded with incantation: ${selectedIncantation}`);
        } else {
          console.log('🔍 RAG: No relevant content found, falling back to full context if available');
        }
      } else if (ragEnabled && ragProcessor.getDocuments().length > 0) {
        console.log(`🔍 RAG: Skipping search for simple query: "${originalInput}"`);
      }

      // Create a placeholder assistant message for streaming
      const assistantMessage: Message = conversationManager.addMessage(conversation.id, {
        role: 'assistant',
        content: '',
        tokens: 0,
        modelUsed: currentModelId
      });

      onConversationUpdate();

      // Stream the response in real-time using current model
      const stream = aiService.streamMessage(
        llamaMessages,
        currentModelId,
        {
          ragContext: intelligentRagContext || ragContext, // Use intelligent context if available, fallback to basic
          systemPrompt: template.systemPrompt,
          temperature: template.parameters.temperature,
          maxTokens: template.parameters.maxTokens,
          topP: template.parameters.topP
        }
      );

      let fullContent = '';

      try {
        for await (const chunk of stream) {
          fullContent += chunk;
        
          // Update the assistant message with the streaming content
          assistantMessage.content = fullContent;
          assistantMessage.tokens = estimateTokenCount(fullContent);
          
          // Trigger a re-render to show the streaming text
          onConversationUpdate();
          
          // Add natural pauses for sentence-like streaming
          if (chunk.includes('.') || chunk.includes('!') || chunk.includes('?') || chunk.includes('\n')) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Longer pause for sentences
          } else {
            await new Promise(resolve => setTimeout(resolve, 20)); // Short pause for words
          }
        }

        
        // After streaming is complete, attach citations if we have them
        if (fullContent.length > 0 && currentCitations.length > 0) {
          const { segments, references } = parseTextWithHighlighting(fullContent, currentCitations, ragDiscoveries);
          assistantMessage.citations = currentCitations;
          assistantMessage.citationReferences = references;
          onConversationUpdate();
        }

        // If no content was streamed, fall back to regular API call
        if (fullContent.length === 0) {

          const response = await aiService.sendMessage(
            llamaMessages,
            currentModelId,
            {
              ragContext: intelligentRagContext || ragContext,
              systemPrompt: template.systemPrompt,
              temperature: template.parameters.temperature,
              maxTokens: template.parameters.maxTokens,
              topP: template.parameters.topP
            }
          );
          
          // Parse text with highlighting and attach citations
          if (currentCitations.length > 0) {
            const { segments, references } = parseTextWithHighlighting(response.content, currentCitations, ragDiscoveries);
            assistantMessage.content = response.content;
            assistantMessage.citations = currentCitations;
            assistantMessage.citationReferences = references;
          } else {
            assistantMessage.content = response.content;
          }
          
          assistantMessage.tokens = response.usage?.completion_tokens || 0;
          assistantMessage.modelUsed = response.model;

          // Check for fallback and show notification
          if (response.fallbackInfo) {
            addNotification({
              type: 'warning',
              title: 'Model Switched Automatically',
              message: `${response.fallbackInfo.originalModel} ${response.fallbackInfo.reason.toLowerCase()}. Switched to ${response.fallbackInfo.fallbackModel}.`,
              duration: 8000,
              actions: [
                {
                  label: 'Try Gemini',
                  onClick: () => handleModelSwitch('gemini-2.0-flash'),
                  variant: 'primary'
                },
                {
                  label: 'Try GPT-4o',
                  onClick: () => handleModelSwitch('gpt-4o'),
                  variant: 'secondary'
                }
              ]
            });
          }

          onConversationUpdate();
        }
            } catch (streamError: any) {
        console.error('🚨 Streaming error:', streamError);
        
        // Check for rate limiting
        if (streamError?.message?.startsWith('RATE_LIMITED:')) {
          const [, originalModel] = streamError.message.split(':');
          
          // Show rate limit notification
          addNotification({
            type: 'warning',
            title: 'Rate Limited',
            message: `${originalModel} has reached its rate limit. Switching to backup model.`,
            duration: 0, // Persistent
            actions: [
              {
                label: 'Try Gemini',
                onClick: () => handleModelSwitch('gemini-2.0-flash'),
                variant: 'primary'
              },
              {
                label: 'Try Llama',
                onClick: () => handleModelSwitch('llama3.1:8b'),
                variant: 'secondary'
              }
            ]
          });
        }

        // Check for automatic fallbacks
        if (streamError?.message?.startsWith('FALLBACK:')) {
          const [, originalModel, reason] = streamError.message.split(':');
          
          addNotification({
            type: 'info',
            title: 'Model Switched Automatically',
            message: `${originalModel} ${reason.toLowerCase()}. Switched to Llama for this response.`,
            duration: 8000,
            actions: [
              {
                label: 'Try Gemini',
                onClick: () => handleModelSwitch('gemini-2.0-flash'),
                variant: 'primary'
              },
              {
                label: 'Try GPT-4o',
                onClick: () => handleModelSwitch('gpt-4o'),
                variant: 'secondary'
              }
            ]
          });
        }
        
        // Fallback to regular API call
        try {
          const response = await aiService.sendMessage(
            llamaMessages,
            currentModelId,
            {
              ragContext: intelligentRagContext || ragContext,
              systemPrompt: template.systemPrompt,
              temperature: template.parameters.temperature,
              maxTokens: template.parameters.maxTokens,
              topP: template.parameters.topP
            }
          );
          
          assistantMessage.content = response.content;
          assistantMessage.tokens = response.usage?.completion_tokens || 0;
          assistantMessage.modelUsed = response.model; // Track actual model used

          // Check for fallback and show notification
          if (response.fallbackInfo) {
            addNotification({
              type: 'warning',
              title: 'Model Switched Automatically',
              message: `${response.fallbackInfo.originalModel} ${response.fallbackInfo.reason.toLowerCase()}. Switched to ${response.fallbackInfo.fallbackModel}.`,
              duration: 8000, // Show for 8 seconds
              actions: [
                {
                  label: 'Try Gemini',
                  onClick: () => handleModelSwitch('gemini-2.0-flash'),
                  variant: 'primary'
                },
                {
                  label: 'Try GPT-4o',
                  onClick: () => handleModelSwitch('gpt-4o'),
                  variant: 'secondary'
                }
              ]
            });
          }

          onConversationUpdate();
        } catch (fallbackError: any) {
          console.error('🚨 Fallback API call also failed:', fallbackError);
          
          // Check for rate limiting in fallback too
          if (fallbackError?.message?.startsWith('RATE_LIMITED:')) {
            addNotification({
              type: 'error',
              title: 'All Models Rate Limited',
              message: 'All available models are currently rate limited. Please try again later.',
              duration: 0,
              actions: [
                {
                  label: 'Retry in 1 minute',
                  onClick: () => {
                    setTimeout(() => {
                      dismissNotification('rate-limit-all');
                    }, 60000);
                  },
                  variant: 'primary'
                }
              ]
            });
          }
          
          assistantMessage.content = 'Sorry, I encountered an error while thinking. Please try again.';
          onConversationUpdate();
        }
      }
      
      // Don't auto-speak responses - let users click the speak button if they want to hear it
      
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date(),
        tokens: 20
      };
      conversationManager.addMessage(conversation.id, errorMessage);
      onConversationUpdate();
    } finally {
      setIsLoading(false);
    }
  };



  const removePDF = (id: string) => {
    // Remove from RAG processor
    ragProcessor.removeDocument(id);
    
    setPdfs(prev => {
      const newPdfs = prev.filter(pdf => pdf.id !== id);
      const newContext = newPdfs.map(pdf => pdf.content).join('\n\n');
      setRagContext(newContext);
      return newPdfs;
    });
  };

  const handleQuestionClick = (question: string) => {
    setInput(question);
    // Removed auto-speak for user questions - only AI responses should be spoken
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // File operations handlers
  const handleApplyChanges = async (filePath: string, content: string) => {
    try {
      const response = await fetch('http://localhost:3001/api/files/apply-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          content,
          directory: workingDirectory,
          backup: true
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Show success notification
        console.log(`✅ Applied changes to ${filePath}`);
      } else {
        throw new Error(result.error || 'Failed to apply changes');
      }
    } catch (error) {
      console.error('Failed to apply changes:', error);
      alert(`Failed to apply changes: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDiscardChanges = () => {
    console.log('💭 Changes discarded');
  };

  // Command execution handler
  const handleExecuteCommand = async (command: string, directory?: string): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
      const response = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          cwd: directory || workingDirectory
        })
      });

      const result = await response.json();
      
      return {
        success: result.success,
        output: result.stdout || result.stderr || 'Command completed',
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  };

  // Enhanced message rendering with code suggestions and incantations
  const renderEnhancedMessage = (content: string) => {
    // Look for code suggestions in markdown format
    const codeSuggestionRegex = /```suggestion:([^\n]+)\n([\s\S]*?)```/g;
    const incantationRegex = /```incantation:([^\n]+)\n([^\n]+)```/g;
    
    let lastIndex = 0;
    const elements: React.ReactNode[] = [];
    let match;

    // Process code suggestions
    while ((match = codeSuggestionRegex.exec(content)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        elements.push(
          <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none">
            <ReactMarkdown>{content.slice(lastIndex, match.index)}</ReactMarkdown>
          </div>
        );
      }

      const filePath = match[1];
      const code = match[2];
      
      elements.push(
        <CodeSuggestion
          key={`suggestion-${match.index}`}
          filePath={filePath}
          suggestedCode={code}
          description={`Update ${filePath}`}
          onApprove={handleApplyChanges}
          onDiscard={handleDiscardChanges}
        />
      );

      lastIndex = match.index + match[0].length;
    }

    // Reset regex and process incantations
    incantationRegex.lastIndex = 0;
    while ((match = incantationRegex.exec(content)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        elements.push(
          <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none">
            <ReactMarkdown>{content.slice(lastIndex, match.index)}</ReactMarkdown>
          </div>
        );
      }

      const description = match[1];
      const command = match[2];
      
      elements.push(
        <IncantationButton
          key={`incantation-${match.index}`}
          command={command}
          description={description}
          workingDirectory={workingDirectory}
          onExecute={handleExecuteCommand}
        />
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      elements.push(
        <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none">
          <ReactMarkdown>{content.slice(lastIndex)}</ReactMarkdown>
        </div>
      );
    }

    // If no special content found, render normally
    if (elements.length === 0) {
      return (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }

    return <div className="space-y-2">{elements}</div>;
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-white">
      {/* Demo Mode Banner */}
      {isDemoMode && (
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 shadow-md">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold">🚀 Demo Mode - GitHub Pages Deployment</h3>
              <p className="text-xs text-blue-100 mt-1">
                This is a public demo without API keys for security. 
                <strong> Only local Llama models are available.</strong> 
                To access OpenAI/Gemini models, clone this repo and add your API keys locally.
              </p>
              <div className="flex items-center space-x-4 mt-2 text-xs">
                <span className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                  <span>Local Llama Models</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                  <span>API Models (Requires Keys)</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notification System */}
      <NotificationSystem 
        notifications={notifications}
        onDismiss={dismissNotification}
      />
      
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {template.icon.startsWith('http') ? (
              <img 
                src={template.icon} 
                alt={template.persona}
                className="w-10 h-10 rounded-full border-2 border-gray-200 object-cover"
              />
            ) : (
              <span className="text-2xl">{template.icon}</span>
            )}
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{template.persona}</h2>
              <p className="text-sm text-gray-600">{template.description}</p>
            </div>
          </div>
          
          {/* Model Switcher and Local Server Manager - Top Right */}
          <div className="flex items-center space-x-3">

            
            <LocalServerManager />
            <ModelSwitcher
              models={modelManager.getAllModels().filter(model => model.status === 'online')}
              currentModelId={currentModelId}
              onModelSwitch={handleModelSwitch}
              compact={true}
            />
          </div>
        </div>
        
        {voiceStatus.error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
            {voiceStatus.error}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {conversation.messages.length === 0 ? (
          template.id === 'local-environment-builder' ? (
            <LocalEnvironmentBuilder currentWorkingDirectory="/Users/danielennis/ai-apps/rate limit message" />
          ) : (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-4">
                {template.icon.startsWith('http') ? (
                  <img 
                    src={template.icon} 
                    alt={template.persona}
                    className="w-20 h-20 rounded-full border-2 border-gray-200 object-cover mx-auto"
                  />
                ) : (
                  <span className="text-4xl">{template.icon}</span>
                )}
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Welcome to {template.name}
              </h3>
              <p className="text-gray-600 mb-6">{template.description}</p>
              
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Try these questions:</h4>
                <div className="grid gap-2 max-w-2xl mx-auto">
                  {template.suggestedQuestions.slice(0, 3).map((question: string, index: number) => (
                    <button
                      key={index}
                      onClick={() => handleQuestionClick(question)}
                      className="p-3 text-left bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-sm"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        ) : (
          conversation.messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-3xl px-4 py-2 rounded-lg ${
                  message.role === 'user' 
                    ? 'bg-[#FFC627] text-[#191919]'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <div className="prose prose-sm max-w-none
                  prose-headings:text-current prose-headings:font-semibold
                  prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
                  prose-p:text-current prose-p:leading-relaxed prose-p:mb-2
                  prose-strong:text-current prose-strong:font-semibold
                  prose-em:text-current
                  prose-ul:text-current prose-ol:text-current
                  prose-li:text-current prose-li:marker:text-current prose-li:mb-1
                  prose-code:text-current prose-code:bg-black prose-code:bg-opacity-10 prose-code:px-1 prose-code:rounded prose-code:text-sm
                  prose-pre:bg-black prose-pre:bg-opacity-5 prose-pre:text-current prose-pre:text-sm
                  prose-blockquote:text-current prose-blockquote:border-l-current prose-blockquote:border-opacity-30
                  prose-hr:border-current prose-hr:border-opacity-20
                  [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  {message.role === 'assistant' && message.citations && message.citations.length > 0 ? (
                    // Enhanced rendering with highlighted citations for assistant messages
                    <div>
                      {(() => {
                        const { segments, references } = parseTextWithHighlighting(message.content, message.citations, ragDiscoveries);
                        
                        // Use either the existing HighlightedText for hover interactions,
                        // or the new InlineCitation for in-line citations with numbers
                        const useInlineCitations = template.features.sourceCitation; // Base on template feature flag
                        
                        return useInlineCitations ? (
                          <InlineCitation 
                            text={message.content}
                            citations={message.citations}
                            references={references}
                          />
                        ) : (
                          <HighlightedText 
                            segments={segments}
                            citations={message.citations}
                            discoveries={ragDiscoveries}
                            onCitationClick={(citationId) => {
                              console.log('Citation clicked:', citationId);
                            }}
                          />
                        );
                      })()}
                    </div>
                  ) : (
                    // Enhanced markdown rendering for messages without citations - includes new coding features
                    message.role === 'user' ? (
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <div className="mb-2">{children}</div>,
                          h1: ({ children }) => <h1 className="text-lg font-semibold mb-2">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-base font-semibold mb-2">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                          strong: ({ children }) => {
                            // Handle citation formatting
                            const text = String(children);
                            if (text.startsWith('[Source:')) {
                              return <span className="inline-block mt-2 px-2 py-1 bg-black bg-opacity-10 rounded-md text-xs font-medium border-l-2 border-current border-opacity-30">{children}</span>;
                            }
                            return <strong>{children}</strong>;
                          }
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      renderEnhancedMessage(message.content)
                    )
                  )}
                </div>
                <div className={`text-xs mt-1 ${
                  message.role === 'user' ? 'text-gray-700' : 'text-gray-500'
                }`}>
                  {formatTime(message.timestamp)}
                  {message.tokens && ` • ${message.tokens} tokens`}
                  {message.modelUsed && ` • ${message.modelUsed}`}
                </div>
                
                {message.role === 'assistant' && message.content && (
                  <button
                    onClick={() => speakText(message.content, true)} // true = AI response
                    disabled={voiceStatus.isSpeaking || !message.content}
                    className="mt-1 text-xs text-[#FFC627] hover:text-yellow-600 disabled:opacity-50 disabled:text-gray-400"
                    title="Speak this response"
                  >
                    {voiceStatus.isSpeaking ? '⏸️ Speaking...' : '🔊 Listen'}
                  </button>
                )}
                
                {/* Show citations for assistant messages if available */}
                {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <CitationRenderer 
                      citations={message.citations}
                      showRelevanceScores={true}
                      maxPreviewLength={150}
                      className="max-w-none"
                    />
                  </div>
                )}
                
                {/* Show discovery panel for the most recent assistant message with discoveries */}
                {message.role === 'assistant' && 
                 conversation.messages[conversation.messages.length - 1]?.id === message.id && 
                 ragDiscoveries.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-purple-200">
                    <RAGDiscoveryPanel 
                      discoveries={ragDiscoveries}
                      onDiscoveryClick={(discovery) => {
                        console.log('Discovery clicked:', discovery);
                      }}
                      className="max-w-none"
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        
        <ProgressiveThinkingIndicator 
          isThinking={isLoading && conversation.messages.length > 0 && conversation.messages[conversation.messages.length - 1].content === ''}
          modelName={modelManager.getAllModels().find(m => m.id === currentModelId)?.name || currentModelId}
          canStream={currentModelId.includes('gpt') || currentModelId.includes('gemini')}
        />
        
        <div ref={messagesEndRef} />
      </div>

      {/* Token Usage Preview */}
      <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white">
        <TokenUsagePreview
          conversation={conversation}
          template={template}
          currentInput={input}
          currentModelId={currentModelId}
          ragContext={ragContext}
          ragDocuments={ragProcessor.getDocuments()}
        />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          {/* RAG Controls */}
          <InlineRAGControls
            ragEnabled={ragEnabled}
            onToggleRAG={setRagEnabled}
            uploadedPDFs={pdfs}
            onUploadPDF={async (file) => {
              setIsProcessingPDF(true);
              try {
                // Use EnhancedRAGProcessor for intelligent document processing
                const processedDoc = await ragProcessor.processFile(file);
                const content = processedDoc.chunks.map(chunk => chunk.content).join('\n\n');
                
                const newPDF: PDFDocument = {
                  id: processedDoc.id,
                  name: processedDoc.name,
                  content: content,
                  pages: 0, // Will be populated by fallback if needed
                  size: file.size,
                  pageCount: 0, // Will be populated by fallback if needed
                  uploadedAt: new Date(),
                  tokenCount: processedDoc.tokenCount
                };
                
                setPdfs(prev => [...prev, newPDF]);
                // Keep basic context for backward compatibility
                setRagContext(prev => prev + '\n\n' + content);
              } catch (error) {
                console.error('Error processing document:', error);
                // Fallback to basic PDF processing if enhanced fails
                try {
                  const processedPDF = await PDFProcessor.processPDF(file);
                  const content = processedPDF.chunks.map(chunk => chunk.content).join('\n\n');
                  const newPDF: PDFDocument = {
                    id: processedPDF.id,
                    name: processedPDF.name,
                    content: content,
                    pages: processedPDF.pageCount,
                    size: file.size,
                    pageCount: processedPDF.pageCount,
                    uploadedAt: new Date(),
                    tokenCount: estimateTokenCount(content)
                  };
                  
                  setPdfs(prev => [...prev, newPDF]);
                  setRagContext(prev => prev + '\n\n' + content);
                } catch (fallbackError) {
                  console.error('Error with fallback PDF processing:', fallbackError);
                }
              } finally {
                setIsProcessingPDF(false);
              }
            }}
            onRemovePDF={removePDF}
            isLoading={isProcessingPDF}
          />

          {/* Voice Input Button */}
          {isVoiceEnabled && (
            <button
              type="button"
              onClick={voiceStatus.isListening ? stopVoiceRecognition : startVoiceRecognition}
              disabled={isLoading || isRateLimited}
              className={`p-3 rounded-lg transition-colors ${
                voiceStatus.isRecording
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } disabled:opacity-50`}
              title={voiceStatus.isListening ? 'Stop listening' : 'Start voice input'}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            </button>
          )}
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isRateLimited 
                ? 'Rate limited - please wait...' 
                : isVoiceEnabled 
                  ? 'Type your message or use voice input...' 
                  : 'Type your message...'
            }
            disabled={isLoading || isRateLimited}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FFC627] focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isRateLimited}
            className="px-6 py-3 bg-[#FFC627] text-[#191919] rounded-lg hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </form>
        
        {/* AI Disclaimer */}
        <div className="mt-3 text-center">
          <p className="text-xs text-gray-500">
            You are speaking with a synthetic version of {template.persona} created with Generative AI
          </p>
        </div>
      </div>


    </div>
  );
};

export default ConversationView; 