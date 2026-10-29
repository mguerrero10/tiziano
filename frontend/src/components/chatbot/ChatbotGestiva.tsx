import React, { useState } from 'react';
import ChatbotHeader from './ChatbotHeader';
import ChatbotOptions from './ChatbotOptions';
import TizianoChatbot from '../tiziano/TizianoChatbot';
import '../../styles/chatbot.css';

interface ChatbotGestivaProps {
  onClose: () => void;
}

const ChatbotGestiva: React.FC<ChatbotGestivaProps> = ({ onClose }) => {
  const [activeAssistant, setActiveAssistant] = useState<'main' | 'tiziano'>('main');

  if (activeAssistant === 'tiziano') {
    return (
      <TizianoChatbot
        onBack={() => setActiveAssistant('main')}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="gestiva-chat-ventana">
      <ChatbotHeader onClose={onClose} />
      
      <div className="gestiva-chat-cuerpo">
        <ChatbotOptions onSelectAssistant={(assistant) => setActiveAssistant(assistant)} />
      </div>
    </div>
  );
};

export default ChatbotGestiva;