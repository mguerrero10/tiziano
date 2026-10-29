const checkoutWindowName = 'turno_salon_mercadopago'

export function openMercadoPagoCheckout(url: string): Window | null {
  return window.open(url, checkoutWindowName)
}

export function closeMercadoPagoCheckout(popup: Window | null | undefined) {
  if (!popup || popup.closed) {
    return
  }
  try {
    popup.close()
  } catch {
    // TO DO Manejar el catchhh no olvidarrrrr
  }
}

// Mercado Pago redirigir al checkout luego meter el pago
export function tryCloseMercadoPagoReturnTab() {
  window.setTimeout(() => {
    try {
      window.close()
    } catch {
      // TO DO Manejar el catchhh no olvidarrrrr
    }
  }, 350)
}
