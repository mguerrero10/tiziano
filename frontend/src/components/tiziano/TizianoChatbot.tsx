import React, { useState } from 'react';
import '../../styles/tiziano.css';

type TizianoChatbotProps = {
  onClose: () => void;
  onBack?: () => void;
};

type Pantalla =
  | 'menu'
  | 'reservarTurno'
  | 'consultarTurnos'
  | 'reprogramarTurno'
  | 'cancelarTurno'
  | 'servicios'
  | 'peluqueria'
  | 'barberia'
  | 'manicuria'
  | 'estetica'
  | 'pestanas'
  | 'precios'
  | 'promociones'
  | 'contacto';

const menu: { pantalla: Pantalla; texto: string }[] = [
  { pantalla: 'reservarTurno', texto: 'Reservar un turno' },
  { pantalla: 'consultarTurnos', texto: 'Consultar mis turnos' },
  { pantalla: 'reprogramarTurno', texto: 'Reprogramar un turno' },
  { pantalla: 'cancelarTurno', texto: 'Cancelar un turno' },
  { pantalla: 'servicios', texto: 'Consultar servicios' },
  { pantalla: 'precios', texto: 'Consultar precios' },
  { pantalla: 'promociones', texto: 'Ver promociones' },
  { pantalla: 'contacto', texto: 'Hablar con una persona' },
];

const areas: { pantalla: Pantalla; titulo: string; servicios: string[] }[] = [
  {
    pantalla: 'peluqueria',
    titulo: 'Peluquería',
    servicios: ['Corte de cabello', 'Tintura y coloración', 'Peinados', 'Alisados', 'Tratamientos capilares'],
  },
  {
    pantalla: 'barberia',
    titulo: 'Barbería',
    servicios: ['Corte de cabello', 'Corte clásico', 'Tratamientos capilares'],
  },
  {
    pantalla: 'manicuria',
    titulo: 'Manicuría',
    servicios: ['Esmaltado tradicional', 'Esmaltado permanente'],
  },
  {
    pantalla: 'estetica',
    titulo: 'Estética',
    servicios: ['Estética corporal', 'Estética facial'],
  },
  {
    pantalla: 'pestanas',
    titulo: 'Pestañas',
    servicios: ['Colocación de pestañas'],
  },
];

const TizianoChatbot: React.FC<TizianoChatbotProps> = ({ onClose, onBack }) => {
  const [pantalla, setPantalla] = useState<Pantalla>('menu');
  const area = areas.find((item) => item.pantalla === pantalla);

  const cerrarChat = () => {
    setPantalla('menu');
    onClose();
  };

  const volverAlMenu = (
    <button type="button" className="tiziano-volver" onClick={() => setPantalla('menu')}>
      Volver al menú
    </button>
  );

  return (
    <div className="tiziano-chatbot">
      <div className="tiziano-chatbot-header">
        <div>
          <div className="tiziano-nombre">Tiziano</div>
          <div className="tiziano-subheader">Peluquería y spa</div>
        </div>

        <div className="tiziano-header-acciones">
          {onBack && (
            <button type="button" className="tiziano-header-volver" onClick={onBack}>
              Gestiva
            </button>
          )}
          <button
            type="button"
            className="tiziano-cerrar"
            onClick={cerrarChat}
            aria-label="Cerrar chat"
          >
            ×
          </button>
        </div>
      </div>

      <div className="tiziano-chatbot-cuerpo">
        {pantalla === 'menu' && (
          <>
            <div className="tiziano-message">Hola, en qué te puedo ayudar?</div>
            {menu.map((item) => (
              <button
                key={item.pantalla}
                type="button"
                className="tiziano-opcion"
                onClick={() => setPantalla(item.pantalla)}
              >
                {item.texto}
              </button>
            ))}
          </>
        )}

        {pantalla === 'servicios' && (
          <>
            <div className="tiziano-message">
              <strong>Servicios</strong>
              Elegí un área.
            </div>
            {areas.map((item) => (
              <button
                key={item.pantalla}
                type="button"
                className="tiziano-opcion"
                onClick={() => setPantalla(item.pantalla)}
              >
                {item.titulo}
              </button>
            ))}
            {volverAlMenu}
          </>
        )}

        {area && (
          <>
            <div className="tiziano-message">
              <strong>{area.titulo}</strong>
            </div>
            <ul className="tiziano-servicios">
              {area.servicios.map((servicio) => (
                <li key={servicio}>{servicio}</li>
              ))}
            </ul>
            <button type="button" className="tiziano-volver" onClick={() => setPantalla('servicios')}>
              Volver a servicios
            </button>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'reservarTurno' && (
          <>
            <div className="tiziano-message">
              <strong>Reservar un turno</strong>
              Elegí el servicio, el profesional y el horario en la agenda online.
            </div>
            <a href="/s/tiziano" className="tiziano-accion" onClick={onClose}>
              Ir a la agenda online
            </a>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'consultarTurnos' && (
          <>
            <div className="tiziano-message">
              <strong>Consultar mis turnos</strong>
              Tus próximos turnos están en la agenda.
            </div>
            <a href="/agenda" className="tiziano-accion" onClick={onClose}>
              Ir a la agenda
            </a>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'reprogramarTurno' && (
          <>
            <div className="tiziano-message">
              <strong>Reprogramar un turno</strong>
              Podés cambiar el horario desde la agenda.
            </div>
            <a href="/agenda" className="tiziano-accion" onClick={onClose}>
              Ir a la agenda
            </a>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'cancelarTurno' && (
          <>
            <div className="tiziano-message">
              <strong>Cancelar un turno</strong>
              Podés cancelarlo desde la agenda.
            </div>
            <a href="/agenda" className="tiziano-accion" onClick={onClose}>
              Ir a la agenda
            </a>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'precios' && (
          <>
            <div className="tiziano-message">
              <strong>Precios</strong>
              Los precios de cada servicio están en la agenda online.
            </div>
            <a href="/s/tiziano" className="tiziano-accion" onClick={onClose}>
              Ver precios
            </a>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'promociones' && (
          <>
            <div className="tiziano-message">
              <strong>Promociones</strong>
              <ul>
                <li>15% de descuento en alisados los martes y miércoles.</li>
                <li>Uñas con una amiga: la segunda tiene 50% off.</li>
              </ul>
            </div>
            <a href="https://instagram.com/tiziano" target="_blank" rel="noreferrer" className="tiziano-accion">
              Instagram
            </a>
            {volverAlMenu}
          </>
        )}

        {pantalla === 'contacto' && (
          <>
            <div className="tiziano-message">
              <strong>Hablar con una persona</strong>
              Escribinos por WhatsApp.
            </div>
            <a
              href="https://wa.me/5491112345678?text=Hola,%20quisiera%20hacer%20una%20consulta"
              target="_blank"
              rel="noreferrer"
              className="tiziano-accion"
            >
              WhatsApp
            </a>
            {volverAlMenu}
          </>
        )}
      </div>
    </div>
  );
};

export default TizianoChatbot;
