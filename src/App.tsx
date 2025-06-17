import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import ConversationHub from './components/ConversationHub';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<ConversationHub />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App; 