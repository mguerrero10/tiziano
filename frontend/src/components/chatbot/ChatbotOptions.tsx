import React from 'react';

interface ChatbotOptionsProps {
  onSelectAssistant: (assistant: 'main' | 'tiziano') => void;
}

const ChatbotOptions: React.FC<ChatbotOptionsProps> = ({ onSelectAssistant }) => {
  return (
    <>
      <div className="gestiva-chatbot-message">Hola, en qué te puedo ayudar?</div>

      <button
        type="button"
        className="gestiva-opcion"
        onClick={() => onSelectAssistant('tiziano')}
      >
        <strong>Tiziano</strong>
        <small>Servicios, turnos y precios</small>
      </button>
    </>
  );
};

export default ChatbotOptions;