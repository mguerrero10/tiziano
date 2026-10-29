export function Brand({
  compact = false,
  logoUrl = null,
  name = null,
}: {
  compact?: boolean
  logoUrl?: string | null
  name?: string | null
}) {
  const salonName = name?.trim() || null
  const initial = salonName?.charAt(0).toUpperCase()

  return (
    <div className={compact ? 'marca marca-compacta' : 'marca'}>
      {logoUrl ? (
        <img className="marca-logotipo" src={logoUrl} alt="" />
      ) : (
        <span className={`marca-simbolo${initial ? ' marca-simbolo-inicial' : ''}`} aria-hidden="true">
          {initial ?? '✂'}
        </span>
      )}
      <p className="marca-texto">
        {salonName ? (
          <span className="marca-nombre">{salonName}</span>
        ) : (
          <>
            <span className="marca-nombre">Turno</span>
            <span className="marca-subheader">Salón</span>
            <span className="marca-centro">Gestión para peluquerías</span>
          </>
        )}
      </p>
    </div>
  )
}
