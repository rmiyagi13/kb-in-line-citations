/**
 * 🔗 Citation Parser - Enhanced RAG Citation Processing
 * 
 * Converts RAG results into structured citations with incantation tracking
 * and text highlighting for interactive source attribution.
 */

import { Citation, CitationReference, HighlightedText, RAGDiscovery } from '../types/index';

// Interface for RAG search results (matches your existing EnhancedRAG structure)
export interface RAGResult {
  chunk: {
    content: string;
    startIndex: number;
    endIndex: number;
    type?: string;
  };
  document: {
    id: string;
    name: string;
    type: string;
    uploadedAt: Date;
  };
  relevanceScore: number;
  context: string;
}

/**
 * Convert RAG results to structured citations with incantation tracking
 */
export function convertRAGResultsToCitations(
  ragResults: RAGResult[], 
  incantationUsed?: string
): Citation[] {
  return ragResults.map((result, index) => ({
    id: `rag-${result.document.id}-${index}`,
    source: result.document.name,
    type: 'rag' as const,
    content: result.context,
    relevance: result.relevanceScore,
    timestamp: result.document.uploadedAt,
    documentId: result.document.id,
    incantationUsed: incantationUsed || 'semantic-search',
    highlightedText: extractHighlightedText(result.context, result.chunk.content),
    confidence: calculateConfidence(result.relevanceScore, result.context.length),
    quality: calculateCitationQuality({
      id: `rag-${result.document.id}-${index}`,
      source: result.document.name,
      type: 'rag',
      content: result.context,
      relevance: result.relevanceScore
    })
  }));
}

/**
 * Extract the most relevant text snippet for highlighting
 */
function extractHighlightedText(fullContext: string, chunkContent: string): string {
  // If chunk content is available and shorter, use it
  if (chunkContent && chunkContent.length < 200) {
    return chunkContent;
  }
  
  // Otherwise, find the most important sentence in the context
  const sentences = fullContext.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return fullContext.substring(0, 150);
  
  // Return the longest sentence (likely most informative)
  const longestSentence = sentences.reduce((prev, current) => 
    current.length > prev.length ? current : prev
  );
  
  return longestSentence.trim();
}

/**
 * Calculate confidence score based on relevance and content quality
 */
function calculateConfidence(relevanceScore: number, contentLength: number): number {
  let confidence = relevanceScore * 0.7; // Base confidence from relevance
  
  // Content length factor
  if (contentLength >= 100 && contentLength <= 500) {
    confidence += 0.2; // Ideal length
  } else if (contentLength >= 50) {
    confidence += 0.1; // Acceptable length
  }
  
  // Semantic quality boost (placeholder - could add NLP analysis)
  confidence += 0.1;
  
  return Math.min(confidence, 1.0);
}

/**
 * Parse text and highlight RAG-sourced content with improved accuracy
 */
export function parseTextWithHighlighting(
  text: string,
  citations: Citation[],
  discoveries: RAGDiscovery[] = []
): {
  segments: HighlightedText[];
  references: CitationReference[];
} {
  const segments: HighlightedText[] = [];
  const references: CitationReference[] = [];
  
  let currentIndex = 0;
  
  // Enhanced algorithm to find citations in text:
  // 1. Look for exact matches first
  // 2. Then look for fuzzy matches using first 40-50 chars
  // 3. Also check for quoted text as these often represent citations
  
  // Process each citation
  for (const citation of citations) {
    // Extract key phrases from citation (up to 3)
    const keyPhrases = extractKeyPhrases(citation.content, 3);
    
    // Try to find matches for each key phrase
    for (const phrase of keyPhrases) {
      if (phrase.length < 15) continue; // Skip short phrases
      
      const phraseIndex = text.indexOf(phrase);
      if (phraseIndex !== -1) {
        // Found a match!
        if (phraseIndex >= currentIndex) {
          // Add non-highlighted text before this match
          if (phraseIndex > currentIndex) {
            segments.push({
              text: text.substring(currentIndex, phraseIndex),
              isHighlighted: false
            });
          }
          
          // Add highlighted text
          segments.push({
            text: phrase,
            isHighlighted: true,
            citationId: citation.id
          });
          
          // Add reference
          references.push({
            citationId: citation.id,
            inlineText: phrase,
            position: phraseIndex,
            highlightStart: phraseIndex,
            highlightEnd: phraseIndex + phrase.length
          });
          
          currentIndex = phraseIndex + phrase.length;
        }
      }
    }
  }
  
  // Check for quoted text - often represents citations
  const quotedTextMatches = text.match(/"([^"]+)"|"([^"]+)"|'([^']+)'/g);
  if (quotedTextMatches) {
    for (const quotedText of quotedTextMatches) {
      // Skip if this text is already part of identified segments
      const quoteIndex = text.indexOf(quotedText);
      if (quoteIndex < currentIndex) continue;
      
      // Look for best matching citation
      const innerText = quotedText.replace(/["""'']/g, '');
      if (innerText.length < 10) continue; // Skip very short quotes
      
      let bestMatch: Citation | null = null;
      let bestScore = 0.4; // Minimum match threshold
      
      for (const citation of citations) {
        const score = calculateSimilarity(innerText, citation.content);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = citation;
        }
      }
      
      if (bestMatch) {
        // Add non-highlighted text before this match
        if (quoteIndex > currentIndex) {
          segments.push({
            text: text.substring(currentIndex, quoteIndex),
            isHighlighted: false
          });
        }
        
        // Add highlighted text
        segments.push({
          text: quotedText,
          isHighlighted: true,
          citationId: bestMatch.id
        });
        
        // Add reference
        references.push({
          citationId: bestMatch.id,
          inlineText: quotedText,
          position: quoteIndex,
          highlightStart: quoteIndex,
          highlightEnd: quoteIndex + quotedText.length
        });
        
        currentIndex = quoteIndex + quotedText.length;
      }
    }
  }
  
  // Add remaining text
  if (currentIndex < text.length) {
    segments.push({
      text: text.substring(currentIndex),
      isHighlighted: false
    });
  }
  
  // If no matches found, return the entire text as non-highlighted
  if (segments.length === 0) {
    segments.push({
      text: text,
      isHighlighted: false
    });
  }
  
  return { segments, references };
}

/**
 * Extract key phrases from text
 */
function extractKeyPhrases(text: string, maxPhrases: number = 3): string[] {
  // Split into sentences first
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length >= 15);
  
  if (sentences.length === 0) {
    return [text.substring(0, Math.min(100, text.length))];
  }
  
  // Score sentences by length and position (earlier sentences are more important)
  const scoredSentences = sentences.map((sentence, index) => ({
    text: sentence.trim(),
    score: sentence.length * (1 - index / sentences.length)
  }));
  
  // Sort by score descending
  scoredSentences.sort((a, b) => b.score - a.score);
  
  // Return top N phrases
  return scoredSentences
    .slice(0, maxPhrases)
    .map(s => s.text);
}

/**
 * Calculate similarity between two strings
 * Uses a simple algorithm based on common substrings
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  // Check for direct containment
  if (s2.includes(s1)) return 0.9;
  if (s1.includes(s2)) return 0.9;
  
  // Check for common words
  const words1 = s1.split(/\s+/).filter(w => w.length > 4);
  const words2 = s2.split(/\s+/).filter(w => w.length > 4);
  
  const words1Set = new Set(words1);
  const words2Set = new Set(words2);
  
  // Get intersection size
  let commonWords = 0;
  words1.forEach(word => {
    if (words2Set.has(word)) commonWords++;
  });
  
  // Calculate Jaccard similarity
  const unionSize = words1Set.size + words2Set.size - commonWords;
  if (unionSize === 0) return 0;
  
  return commonWords / unionSize;
}

/**
 * Create a RAG discovery record
 */
export function createRAGDiscovery(
  query: string,
  incantationUsed: string,
  citations: Citation[],
  context: string
): RAGDiscovery {
  return {
    query,
    incantationUsed,
    timestamp: new Date(),
    results: citations,
    confidence: citations.length > 0 ? 
      citations.reduce((sum, c) => sum + (c.confidence || 0), 0) / citations.length : 0,
    context
  };
}

/**
 * Enhanced citation quality calculation
 */
export function calculateCitationQuality(citation: Partial<Citation>): number {
  let score = (citation.relevance || 0) * 0.6; // 60% weight for relevance
  
  // Content length factor
  const contentLength = citation.content?.length || 0;
  let lengthScore = 0;
  
  if (contentLength >= 50 && contentLength <= 300) {
    lengthScore = 1; // Ideal length
  } else if (contentLength >= 20 && contentLength <= 500) {
    lengthScore = 0.8; // Good length
  } else if (contentLength >= 10) {
    lengthScore = 0.5; // Acceptable length
  }
  
  score += lengthScore * 0.2; // 20% weight for length
  
  // Confidence factor
  score += (citation.confidence || 0.5) * 0.2; // 20% weight for confidence
  
  return Math.min(score, 1);
}

/**
 * Legacy function for backward compatibility
 */
export function parseTextWithCitations(text: string, citations: Citation[]): {
  cleanText: string;
  references: CitationReference[];
} {
  const { segments, references } = parseTextWithHighlighting(text, citations);
  const cleanText = segments.map(s => s.text).join('');
  return { cleanText, references };
}

/**
 * Extract relevant quotes from citations based on query terms
 */
export function extractRelevantQuotes(
  citations: Citation[], 
  queryTerms: string[], 
  maxQuoteLength: number = 150
): Citation[] {
  return citations.map(citation => {
    const terms = queryTerms.map(term => term.toLowerCase());
    
    // Find best matching excerpt
    let bestMatch = '';
    let bestScore = 0;
    
    // Split content into sentences
    const sentences = citation.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      if (sentence.length === 0) continue;
      
      // Check how many query terms appear in this sentence
      const score = terms.reduce((acc, term) => {
        return acc + (sentence.toLowerCase().includes(term) ? 1 : 0);
      }, 0);
      
      if (score > bestScore || (score === bestScore && sentence.length < bestMatch.length)) {
        bestScore = score;
        bestMatch = sentence;
      }
    }
    
    // If no good match found, use beginning of content
    if (!bestMatch || bestScore === 0) {
      bestMatch = citation.content.substring(0, maxQuoteLength);
      if (citation.content.length > maxQuoteLength) {
        bestMatch += '...';
      }
    }
    
    return {
      ...citation,
      content: bestMatch
    };
  });
}

/**
 * Create citation markers for text based on RAG results
 */
export function insertCitationMarkers(
  text: string, 
  ragResults: RAGResult[]
): { 
  textWithCitations: string; 
  citations: Citation[] 
} {
  const citations = convertRAGResultsToCitations(ragResults);
  let textWithCitations = text;
  
  // For now, append citation numbers at the end of relevant sentences
  // This is a simple implementation - could be enhanced with NLP
  citations.forEach((citation, index) => {
    const citationNumber = index + 1;
    const marker = ` [${citationNumber}]`;
    
    // Try to find a good place to insert the citation marker
    // Look for sentences that contain similar content
    const sentences = textWithCitations.split(/([.!?]+)/);
    
    for (let i = 0; i < sentences.length; i += 2) { // Every other element is a sentence
      const sentence = sentences[i];
      if (sentence && sentence.trim().length > 10) {
        // Simple similarity check - could be enhanced
        const sentenceLower = sentence.toLowerCase();
        const citationWords = citation.content.toLowerCase().split(/\s+/).slice(0, 5);
        
        const matchCount = citationWords.reduce((count, word) => {
          return count + (sentenceLower.includes(word) ? 1 : 0);
        }, 0);
        
        if (matchCount >= 2) {
          sentences[i] = sentence + marker;
          break;
        }
      }
    }
    
    textWithCitations = sentences.join('');
  });
  
  return {
    textWithCitations,
    citations
  };
}

/**
 * Generate a bibliography from citations
 */
export function generateBibliography(citations: Citation[]): string {
  const sortedCitations = [...citations].sort((a, b) => a.source.localeCompare(b.source));
  
  return sortedCitations.map((citation, index) => {
    const number = index + 1;
    const date = citation.timestamp ? citation.timestamp.toLocaleDateString() : 'Unknown date';
    
    switch (citation.type) {
      case 'rag':
      case 'document':
        return `${number}. ${citation.source}. ${date}. Retrieved from uploaded document.`;
      case 'external':
        return `${number}. ${citation.source}. ${date}. ${citation.url || 'External source'}.`;
      case 'knowledge':
        return `${number}. ${citation.source}. Internal knowledge base.`;
      default:
        return `${number}. ${citation.source}. ${date}.`;
    }
  }).join('\n');
}

/**
 * Filter and rank citations by quality
 */
export function filterAndRankCitations(
  citations: Citation[], 
  minQuality: number = 0.3,
  maxCitations: number = 5
): Citation[] {
  return citations
    .map(citation => ({
      ...citation,
      quality: calculateCitationQuality(citation)
    }))
    .filter(citation => citation.quality >= minQuality)
    .sort((a, b) => b.quality - a.quality)
    .slice(0, maxCitations);
} 