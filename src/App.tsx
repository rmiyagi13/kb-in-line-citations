import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ConversationHub from './components/ConversationHub';

function App() {
  return (
    <Router basename={process.env.NODE_ENV === 'production' ? '/kb-in-line-citations' : ''}>
      <div className="App">
        <Routes>
          <Route path="/" element={<ConversationHub />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App; 