import { useMemo, useState } from 'react'

type FaqCategory =
  | 'General'
  | 'Clientes'
  | 'Servicios'
  | 'Productos'
  | 'Profesionales'
  | 'Turnos'

type FaqItem = {
  id: string
  category: FaqCategory
  question: string
  answer: string
}

const CATEGORIES: FaqCategory[] = [
  'General',
  'Clientes',
  'Servicios',
  'Productos',
  'Profesionales',
  'Turnos',
]

const FAQS: FaqItem[] = [
  // General
  {
    id: 'gen-1',
    category: 'General',
    question: '¿Qué significa "ABM"?',
    answer:
      'ABM son las siglas de Alta, Baja y Modificación. En cada sección del panel (Clientes, Servicios, Productos, Profesionales y Turnos) vas a encontrar las mismas tres acciones: crear un registro nuevo (Alta), editarlo (Modificación) y eliminarlo o desactivarlo (Baja).',
  },
  {
    id: 'gen-2',
    category: 'General',
    question: '¿Cómo navego entre las secciones del panel?',
    answer:
      'Usá el menú lateral izquierdo. Cada ícono te lleva a una sección distinta: Dashboard, Clientes, Servicios, Productos, Profesionales, Agenda y Ajustes. Podés colapsar el menú con el botón circular para ganar espacio en pantalla.',
  },
  {
    id: 'gen-3',
    category: 'General',
    question: '¿Los cambios que hago se guardan al instante?',
    answer:
      'Sí. Al confirmar un formulario de alta o edición, el dato se guarda automáticamente y la lista se actualiza en el momento, sin necesidad de recargar la página.',
  },
  {
    id: 'gen-4',
    category: 'General',
    question: '¿Cómo cambio el logo del salón?',
    answer:
      'Entrá a Ajustes desde el menú lateral o desde el menú de tu usuario. Elegí una imagen y guardala. El logo aparece en el panel y en la web de reservas. Podés quitarlo desde la misma pantalla.',
  },
  {
    id: 'gen-5',
    category: 'General',
    question: '¿Puedo deshacer una eliminación?',
    answer:
      'No de forma automática. Por eso, antes de eliminar un registro, el sistema te va a pedir una confirmación. Si tenés dudas, es preferible desactivar en lugar de eliminar cuando la opción esté disponible.',
  },
  // Clientes
  {
    id: 'cli-1',
    category: 'Clientes',
    question: '¿Cómo doy de alta un nuevo cliente?',
    answer:
      'Entrá a la sección "Clientes" desde el menú lateral y tocá el botón "Nuevo cliente". Completá nombre, teléfono y los datos de contacto disponibles, y confirmá para guardarlo.',
  },
  {
    id: 'cli-2',
    category: 'Clientes',
    question: '¿Cómo edito los datos de un cliente?',
    answer:
      'Buscá al cliente en el listado (podés usar el buscador de la sección) y tocá "Editar" en su tarjeta. Modificá los campos que necesites y confirmá para actualizar la información.',
  },
  {
    id: 'cli-3',
    category: 'Clientes',
    question: '¿Cómo elimino o doy de baja un cliente?',
    answer:
      'Desde la tarjeta del cliente vas a encontrar la opción "Eliminar" o "Desactivar". Si el cliente tiene turnos asociados, te recomendamos desactivarlo en lugar de eliminarlo, para conservar el historial.',
  },
  {
    id: 'cli-4',
    category: 'Clientes',
    question: '¿Puedo ver el historial de turnos de un cliente?',
    answer:
      'Sí, dentro de la ficha de cada cliente vas a poder consultar sus próximos turnos y los turnos anteriores registrados en el sistema.',
  },
  // Servicios
  {
    id: 'srv-1',
    category: 'Servicios',
    question: '¿Cómo agrego un nuevo servicio?',
    answer:
      'En la sección "Servicios", tocá "Nuevo servicio" y completá nombre, duración estimada, precio y el módulo al que pertenece. Al confirmar, el servicio queda disponible para asignarlo a turnos.',
  },
  {
    id: 'srv-2',
    category: 'Servicios',
    question: '¿Cómo modifico el precio o la duración de un servicio?',
    answer:
      'Tocá el precio o el campo que quieras editar directamente sobre la tarjeta del servicio, escribí el nuevo valor y confirmá con el botón de guardar que aparece al lado.',
  },
  {
    id: 'srv-3',
    category: 'Servicios',
    question: '¿Cómo desactivo un servicio sin borrarlo?',
    answer:
      'Cada servicio tiene un interruptor de "Activo / Inactivo". Al desactivarlo, deja de estar disponible para nuevos turnos pero se conserva en el historial de turnos ya realizados.',
  },
  {
    id: 'srv-4',
    category: 'Servicios',
    question: '¿Qué pasa si elimino un servicio que ya tiene turnos agendados?',
    answer:
      'El sistema te va a advertir si el servicio tiene turnos asociados. En esos casos es preferible desactivarlo en lugar de eliminarlo, para no perder la información de esos turnos.',
  },
  // Productos
  {
    id: 'prod-1',
    category: 'Productos',
    question: '¿Cómo cargo un producto nuevo?',
    answer:
      'Desde "Productos", tocá "Nuevo producto" y completá nombre, precio y stock inicial (si tu plan incluye control de stock). Confirmá para agregarlo al catálogo.',
  },
  {
    id: 'prod-2',
    category: 'Productos',
    question: '¿Cómo edito el stock o el precio de un producto?',
    answer:
      'Ingresá a la ficha del producto y tocá "Editar". Ahí vas a poder actualizar precio, stock y descripción. Los cambios se reflejan al instante en el listado.',
  },
  {
    id: 'prod-3',
    category: 'Productos',
    question: '¿Cómo elimino un producto?',
    answer:
      'Tocá "Eliminar" en la tarjeta del producto y confirmá la acción. Si el producto tiene ventas registradas, se recomienda desactivarlo en lugar de eliminarlo.',
  },
  // Profesionales
  {
    id: 'prof-1',
    category: 'Profesionales',
    question: '¿Cómo agrego un nuevo profesional al equipo?',
    answer:
      'En "Profesionales", tocá "Nuevo profesional" y cargá su nombre, contacto y los servicios que puede realizar. Al guardar, ya va a poder ser asignado en la agenda.',
  },
  {
    id: 'prof-2',
    category: 'Profesionales',
    question: '¿Cómo edito los servicios que ofrece un profesional?',
    answer:
      'Entrá a la ficha del profesional y tocá "Editar". Ahí podés marcar o desmarcar los servicios que realiza y actualizar sus datos de contacto.',
  },
  {
    id: 'prof-3',
    category: 'Profesionales',
    question: '¿Cómo doy de baja a un profesional?',
    answer:
      'Podés eliminarlo o desactivarlo desde su ficha. Si tiene turnos futuros asignados, el sistema te va a pedir que los reasignes o canceles antes de darlo de baja.',
  },
  // Turnos / Agenda
  {
    id: 'turn-1',
    category: 'Turnos',
    question: '¿Cómo creo un turno nuevo desde la agenda?',
    answer:
      'En "Agenda", seleccioná el día y horario disponible, elegí cliente, profesional y servicio, y confirmá. El turno va a aparecer inmediatamente en el calendario.',
  },
  {
    id: 'turn-2',
    category: 'Turnos',
    question: '¿Cómo modifico o reprogramo un turno?',
    answer:
      'Tocá el turno en la agenda o en el listado del día y elegí "Editar". Desde ahí podés cambiar fecha, horario, profesional o servicio asignado.',
  },
  {
    id: 'turn-3',
    category: 'Turnos',
    question: '¿Cómo cancelo un turno?',
    answer:
      'Abrí el turno y tocá "Cancelar". El turno queda marcado como cancelado y se libera el horario para que pueda reservarse nuevamente.',
  },
  {
    id: 'turn-4',
    category: 'Turnos',
    question: '¿Qué significan los colores y etiquetas de los turnos?',
    answer:
      'Cada etiqueta indica un estado distinto: pendiente, confirmado, completado, cancelado o no asistió. También vas a ver etiquetas de método y estado de pago cuando corresponda.',
  },
]

export function FaqsPage() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<'Todas' | FaqCategory>('Todas')
  const [openId, setOpenId] = useState<string | null>(null)

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return FAQS.filter((faq) => {
      const matchesCategory = activeCategory === 'Todas' || faq.category === activeCategory
      const matchesQuery =
        normalizedQuery.length === 0 ||
        faq.question.toLowerCase().includes(normalizedQuery) ||
        faq.answer.toLowerCase().includes(normalizedQuery)
      return matchesCategory && matchesQuery
    })
  }, [query, activeCategory])

  return (
    <div className="panel preguntas-pagina">
      <style>{`
        .preguntas-busqueda {
          position: relative;
          margin-top: 22px;
        }
        .preguntas-busqueda input {
          padding-left: 44px;
        }
        .preguntas-busqueda svg {
          position: absolute;
          top: 50%;
          left: 15px;
          transform: translateY(-50%);
          color: #7a6a60;
          pointer-events: none;
        }
        .preguntas-pestanas {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 16px;
        }
        .preguntas-lista {
          display: grid;
          gap: 10px;
          margin-top: 20px;
        }
        .preguntas-elemento {
          border: 1px solid #2b211c1c;
          border-radius: 16px;
          background: #fffaf6;
          overflow: hidden;
        }
        .preguntas-elemento-pregunta {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          border: 0;
          background: transparent;
          color: #2b211c;
          font: 600 13px "Inter";
          text-align: left;
          cursor: pointer;
        }
        .preguntas-elemento-pregunta:hover {
          background: #2b211c0b;
        }
        .preguntas-elemento-flecha {
          flex-shrink: 0;
          color: #9a6f3d;
          transition: transform 0.18s ease;
        }
        .preguntas-elemento.esta-abierto .preguntas-elemento-flecha {
          transform: rotate(90deg);
        }
        .preguntas-elemento-respuesta {
          padding: 0 18px 18px;
          color: #7a6a60;
          font-size: 12.5px;
          line-height: 1.65;
        }
        .preguntas-elemento-categoria {
          display: inline-block;
          margin: 0 18px 0;
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(168, 93, 100, 0.1);
          color: #9a6f3d;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
      `}</style>

      <div className="header-panel">
        <div>
          <span className="antetitulo">Ayuda</span>
          <h1>Preguntas frecuentes</h1>
          <p>Guías rápidas para usar los módulos de Clientes, Servicios, Productos, Profesionales y Turnos.</p>
        </div>
      </div>

      <div className="tarjeta-panel">
        <div className="preguntas-busqueda">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Buscar una pregunta, por ejemplo: cómo agrego un cliente"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="preguntas-pestanas">
          <button
            type="button"
            className={`modulo-pestana ${activeCategory === 'Todas' ? 'esta-activo' : ''}`}
            onClick={() => setActiveCategory('Todas')}
          >
            Todas
          </button>
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              className={`modulo-pestana ${activeCategory === category ? 'esta-activo' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="preguntas-lista">
          {results.length === 0 && (
            <div className="vacio-situacion">
              <p>No encontramos preguntas para tu búsqueda.</p>
              <small>Probá con otras palabras o elegí otra categoría.</small>
            </div>
          )}

          {results.map((faq) => {
            const isOpen = openId === faq.id
            return (
              <div key={faq.id} className={`preguntas-elemento ${isOpen ? 'esta-abierto' : ''}`}>
                <button
                  type="button"
                  className="preguntas-elemento-pregunta"
                  onClick={() => setOpenId(isOpen ? null : faq.id)}
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <svg className="preguntas-elemento-flecha" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                {isOpen && (
                  <>
                    <span className="preguntas-elemento-categoria">{faq.category}</span>
                    <p className="preguntas-elemento-respuesta">{faq.answer}</p>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
