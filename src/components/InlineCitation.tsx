import React from 'react';
import { Citation, CitationReference } from '../types/index';
import CitationTooltip from './CitationTooltip';

interface InlineCitationProps {
  text: string;
  citations: Citation[];
  references: CitationReference[];
  className?: string;
}

interface TextSegment {
  text: string;
  citationId?: string;
  index?: number;
}

/**
 * InlineCitation Component
 * 
 * This component parses text and places citation markers inline with the text.
 * It integrates with CitationTooltip to show citation information on hover.
 */
const InlineCitation: React.FC<InlineCitationProps> = ({ 
  text, 
  citations, 
  references,
  className = ''
}) => {
  if (!citations || citations.length === 0 || !references || references.length === 0) {
    return <div className={className}>{text}</div>;
  }
  
  // Create a mapping of citation IDs to their index + 1 (for citation numbers)
  const citationIndexMap = new Map<string, number>();
  citations.forEach((citation, index) => {
    citationIndexMap.set(citation.id, index + 1);
  });
  
  // Create segments from the text based on reference positions
  const segments: TextSegment[] = [];
  let lastPosition = 0;
  
  // Sort references by position (ascending)
  const sortedReferences = [...references].sort((a, b) => a.position - b.position);
  
  sortedReferences.forEach(reference => {
    // Add text before the citation
    if (reference.position > lastPosition) {
      segments.push({
        text: text.substring(lastPosition, reference.position)
      });
    }
    
    // Add the citation text
    segments.push({
      text: reference.inlineText,
      citationId: reference.citationId,
      index: citationIndexMap.get(reference.citationId)
    });
    
    lastPosition = reference.position + reference.inlineText.length;
  });
  
  // Add remaining text after all citations
  if (lastPosition < text.length) {
    segments.push({
      text: text.substring(lastPosition)
    });
  }
  
  return (
    <div className={className}>
      {segments.map((segment, idx) => {
        if (segment.citationId && segment.index) {
          const citation = citations.find(c => c.id === segment.citationId);
          if (citation) {
            return (
              <CitationTooltip
                key={`segment-${idx}`}
                citation={citation}
                citationNumber={segment.index}
              >
                {segment.text}
              </CitationTooltip>
            );
          }
        }
        return <span key={`segment-${idx}`}>{segment.text}</span>;
      })}
    </div>
  );
};

export default InlineCitation; 