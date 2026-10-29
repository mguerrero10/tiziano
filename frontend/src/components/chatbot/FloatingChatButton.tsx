import React, { useState } from 'react';
import ChatbotGestiva from './ChatbotGestiva';
import '../../styles/floatingButton.css';
import gestivaLogo from '../../assets/images/gestiva-logo.jpg';

const FloatingChatButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {isOpen && (
        <ChatbotGestiva onClose={() => setIsOpen(false)} />
      )}

      <div className="gestiva-flotante-contenedor">
        {!isOpen && (
          <div className="gestiva-bienvenida-message">
            Necesitás ayuda?
          </div>
        )}

        <button 
          type="button"
          className="gestiva-flotante-boton"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? "Cerrar chat" : "Abrir chat"}
        >
          <img 
            src={gestivaLogo} 
            alt="" 
            className="gestiva-flotante-logotipo"
          />
        </button>
      </div>
    </>
  );
};

export default FloatingChatButton;