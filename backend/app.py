from flask import Flask, request, jsonify
import subprocess
import json
import os
import sys

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'specialization': 'Advanced Llama 4 Scout with comprehensive AI assistance',
        'capabilities': [
            'Analytical thinking and reasoning',
            'Technical guidance and support',
            'General-purpose conversation assistance',
            'Adaptive problem solving'
        ]
    })

@app.route('/api/chat/completions', methods=['POST'])
def chat_completions():
    data = request.json
    messages = data.get('messages', [])
    user_messages = [m for m in messages if m['role'] == 'user']
    user_message = user_messages[-1]['content'] if user_messages else ''
    
    system_messages = [m for m in messages if m['role'] == 'system']
    rag_context = system_messages[0]['content'] if system_messages else ''
    
    # Generate a response (simplified version of the Node.js implementation)
    response = generate_response(user_message, rag_context)
    
    return jsonify({
        'choices': [{
            'message': {
                'role': 'assistant',
                'content': response
            },
            'finish_reason': 'stop'
        }],
        'usage': {
            'prompt_tokens': len(user_message) // 4,
            'completion_tokens': len(response) // 4,
            'total_tokens': (len(user_message) + len(response)) // 4
        },
        'model': 'llama4-scout-advanced'
    })

def generate_response(query, context=''):
    """Generate a response based on the query and context"""
    if context:
        return f"Here's information based on your query about '{query}' with the provided context. The context contains {len(context)} characters of information that I've analyzed to provide a comprehensive response."
    else:
        return f"I've analyzed your query about '{query}' and here's what I can tell you. This is a simulated response from the backend service."

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080))) 