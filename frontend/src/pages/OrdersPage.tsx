import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { apiGet, apiPatch } from "../lib/api";

type Order = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  amount: number;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }[];
};

type PaymentChannel = "cash" | "transfer" | "debit" | "credit";
const paymentChannels: { value: PaymentChannel; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "debit", label: "Tarjeta de débito" },
  { value: "credit", label: "Tarjeta de crédito" },
];

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});
const paymentLabels: Record<string, string> = {
  paid: "Pagado",
  unpaid: "Sin pagar",
  pending: "Pago pendiente",
  failed: "Pago fallido",
  refunded: "Reembolsado",
};
const paymentTones: Record<string, string> = {
  paid: "exito",
  unpaid: "advertencia",
  pending: "pendiente",
  failed: "peligro",
  refunded: "neutro",
};

export function OrdersPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [payment, setPayment] = useState("");
  const [delivery, setDelivery] = useState("");
  const [search, setSearch] = useState("");
  const [confirmation, setConfirmation] = useState<{
    order: Order;
    action: string;
  } | null>(null);
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>("cash");

  useEffect(() => {
    if (!token) return;
    let active = true;
    apiGet<Order[]>("/api/product-orders", token)
      .then((data) => {
        if (active) {
          setOrders(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error && reason.message
              ? reason.message
              : "No se pudieron cargar los pedidos.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, revision]);

  function reloadOrders() {
    setLoading(true);
    setRevision((value) => value + 1);
  }

  async function updateOrder(order: Order, action: string) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/product-orders/${order.id}`, token, {
        action,
        ...(action === "pay" ? { paymentChannel } : {}),
      });
      setConfirmation(null);
      reloadOrders();
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : "No se pudo actualizar el pedido.",
      );
    } finally {
      setBusy(false);
    }
  }

  const visible = orders.filter((order) => {
    if (payment === "paid" && order.paymentStatus !== "paid") return false;
    if (
      payment === "unpaid" &&
      ["paid", "refunded"].includes(order.paymentStatus)
    )
      return false;
    if (payment === "refunded" && order.paymentStatus !== "refunded")
      return false;
    if (delivery === "delivered" && !order.deliveredAt) return false;
    if (
      delivery === "pending" &&
      (order.deliveredAt || order.status === "cancelled")
    )
      return false;
    if (delivery === "cancelled" && order.status !== "cancelled") return false;
    const term = search.trim().toLocaleLowerCase("es");
    return (
      !term ||
      [
        order.id,
        order.customerName,
        order.customerPhone,
        order.customerEmail,
        ...order.items.map((item) => item.productName),
      ].some((value) => value.toLocaleLowerCase("es").includes(term))
    );
  });

  return (
    <div className="pagos-pagina pedidos-pagina">
      <header className="pagos-pagina-header">
        <div>
          <h1>Pedidos</h1>
          <p>Historial de compras y reservas de la tienda.</p>
        </div>
        <button
          type="button"
          className="secundario"
          disabled={loading || busy}
          onClick={reloadOrders}
        >
          Actualizar
        </button>
      </header>
      <div className="pedidos-filtros">
        <label>
          Buscar
          <input
            type="search"
            value={search}
            placeholder="Cliente, producto o pedido"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Pago
          <select
            value={payment}
            onChange={(event) => setPayment(event.target.value)}
          >
            <option value="">Todos los pagos</option>
            <option value="paid">Pagados</option>
            <option value="unpaid">Sin pagar</option>
            <option value="refunded">Reembolsados</option>
          </select>
        </label>
        <label>
          Entrega
          <select
            value={delivery}
            onChange={(event) => setDelivery(event.target.value)}
          >
            <option value="">Todas las entregas</option>
            <option value="pending">Sin entregar</option>
            <option value="delivered">Entregados</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </label>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && !visible.length ? (
        <p className="vacio-situacion">No hay pedidos con estos filtros.</p>
      ) : null}
      <div className="pedidos-lista">
        {visible.map((order) => (
          <article className="pedido-tarjeta" key={order.id}>
            <header>
              <div>
                <h2>{order.customerName}</h2>
                <small>
                  {new Date(order.createdAt).toLocaleString("es-AR")} · Pedido{" "}
                  {order.id}
                </small>
                <p>
                  {order.customerPhone} · {order.customerEmail}
                </p>
              </div>
              <div className="pedido-tarjeta-resumen">
                <div
                  className="pedido-tarjeta-etiquetas"
                  aria-label="Estado del pedido"
                >
                  <span
                    className={`pedido-estado-etiqueta pedido-estado-etiqueta-${paymentTones[order.paymentStatus] ?? "neutro"}`}
                  >
                    {paymentLabels[order.paymentStatus] ?? order.paymentStatus}
                  </span>
                  {order.status === "cancelled" ? (
                    <span className="pedido-estado-etiqueta pedido-estado-etiqueta-peligro">
                      Cancelado
                    </span>
                  ) : order.status === "awaiting_stock" ? (
                    <span className="pedido-estado-etiqueta pedido-estado-etiqueta-advertencia">
                      Revisar stock
                    </span>
                  ) : null}
                  <span
                    className={`pedido-estado-etiqueta ${
                      order.deliveredAt
                        ? "pedido-estado-etiqueta-exito"
                        : "pedido-estado-etiqueta-advertencia"
                    }`}
                  >
                    {order.deliveredAt ? "Entregado" : "Sin entregar"}
                  </span>
                </div>
                <strong className="pedido-tarjeta-importe">
                  {money.format(order.amount)}
                </strong>
              </div>
            </header>
            <ul>
              {order.items.map((item) => (
                <li key={item.productId}>
                  {item.quantity} × {item.productName} ·{" "}
                  {money.format(item.unitPrice * item.quantity)}
                </li>
              ))}
            </ul>
            <div className="pedido-tarjeta-situaciones">
              <span className="pedido-tarjeta-pago-metodo">
                {order.paymentMethod === "salon"
                  ? "Pago al retirar"
                  : "Mercado Pago"}
              </span>
              {order.deliveredAt ? (
                <span>
                  Entregado el{" "}
                  {new Date(order.deliveredAt).toLocaleString("es-AR")}
                </span>
              ) : null}
              {order.status === "pending" ? (
                <span>Esperando confirmación del pago</span>
              ) : null}
              {order.status === "awaiting_stock" ? (
                <strong className="pedido-tarjeta-existencias-aviso">
                  Pago acreditado: revisá el stock antes de entregar.
                </strong>
              ) : null}
            </div>
            <footer className="pedido-tarjeta-footer">
              <div className="pedido-tarjeta-actual-entrega">
                <span>Estado de entrega</span>
                <strong
                  className={`pedido-estado-etiqueta ${
                    order.deliveredAt
                      ? "pedido-estado-etiqueta-exito"
                      : order.status === "cancelled"
                        ? "pedido-estado-etiqueta-peligro"
                        : "pedido-estado-etiqueta-advertencia"
                  }`}
                >
                  {order.deliveredAt
                    ? "Entregado"
                    : order.status === "cancelled"
                      ? "No entregado · cancelado"
                      : "Sin entregar"}
                </strong>
              </div>
              {order.status !== "cancelled" ? (
                <div className="pedido-tarjeta-acciones">
                  {order.paymentMethod === "salon" &&
                  order.paymentStatus !== "paid" ? (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || loading}
                      onClick={() => {
                        setPaymentChannel("cash");
                        setConfirmation({ order, action: "pay" });
                      }}
                    >
                      Registrar cobro
                    </button>
                  ) : null}
                  {order.status === "confirmed" ||
                  order.status === "awaiting_stock" ? (
                    <button
                      type="button"
                      className="secundario"
                      disabled={busy || loading}
                      onClick={() =>
                        void updateOrder(
                          order,
                          order.deliveredAt ? "undeliver" : "deliver",
                        )
                      }
                    >
                      {order.deliveredAt
                        ? "Marcar sin entregar"
                        : "Marcar entregado"}
                    </button>
                  ) : null}
                  {order.paymentStatus !== "paid" &&
                  !order.deliveredAt &&
                  order.paymentMethod === "salon" ? (
                    <button
                      type="button"
                      className="secundario"
                      disabled={busy || loading}
                      onClick={() =>
                        setConfirmation({ order, action: "cancel" })
                      }
                    >
                      Cancelar reserva
                    </button>
                  ) : null}
                </div>
              ) : null}
            </footer>
          </article>
        ))}
      </div>
      {confirmation ? (
        <div className="modal-fondo" role="presentation">
          <section
            className="modal-tarjeta"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-confirm-title"
          >
            <h2 id="order-confirm-title">
              {confirmation.action === "pay"
                ? "Confirmar cobro"
                : "Cancelar reserva"}
            </h2>
            <p>
              {confirmation.action === "pay"
                ? `Confirmá que recibiste ${money.format(confirmation.order.amount)} de ${confirmation.order.customerName}.`
                : "Se liberará el stock reservado. Esta acción no se puede deshacer."}
            </p>
            {confirmation.action === "pay" ? (
              <label className="pedido-pago-metodo">
                Medio de pago
                <select
                  value={paymentChannel}
                  disabled={busy}
                  onChange={(event) =>
                    setPaymentChannel(event.target.value as PaymentChannel)
                  }
                >
                  {paymentChannels.map((channel) => (
                    <option value={channel.value} key={channel.value}>
                      {channel.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal-form-acciones">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  void updateOrder(confirmation.order, confirmation.action)
                }
              >
                Confirmar
              </button>
              <button
                type="button"
                className="secundario"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Volver
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
