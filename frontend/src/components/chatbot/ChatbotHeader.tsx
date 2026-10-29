import React from 'react';
import gestivaLogo from '../../assets/images/gestiva-logo.jpg';

interface ChatbotHeaderProps {
  onClose: () => void;
}

const ChatbotHeader: React.FC<ChatbotHeaderProps> = ({ onClose }) => {
  return (
    <header className="gestiva-chat-header">
      <div className="gestiva-chat-marca">
        <img 
          src={gestivaLogo} 
          alt="" 
          className="gestiva-header-logotipo"
        />
        <h2>Gestiva</h2>
      </div>
      <button
        type="button"
        className="gestiva-cerrar-boton"
        onClick={onClose}
        aria-label="Cerrar chat"
      >
        ×
      </button>
    </header>
  );
};

export default ChatbotHeader;