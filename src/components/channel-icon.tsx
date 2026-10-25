/**
 * Iconos de marca: SVG INLINE.
 *
 * Las librerías de iconos ya no los incluyen por temas de licencia, así que
 * van acá, dibujados a mano. Solo se usan en la UI; la lógica no depende de
 * ellos.
 */
import type { Channel } from "@/lib/zernio/types";

interface IconProps {
  className?: string;
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.347-.347.52-.52.174-.174.232-.298.347-.497.116-.198.058-.371-.03-.52-.087-.148-.661-1.59-.906-2.177-.238-.571-.48-.621-.66-.631-.17-.008-.366-.01-.56-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.417-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

export function MessengerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0C5.24 0 0 4.95 0 11.64c0 3.5 1.44 6.53 3.78 8.63.24.22.39.53.4.87l.08 2.77c.03.93.98 1.5 1.79 1.09l3.1-1.73c.26-.15.57-.19.86-.12 1.25.34 2.6.52 3.99.52 6.76 0 12-4.95 12-11.64S18.76 0 12 0zm6.63 8.86l-3.31 5.26c-.53.84-1.66 1.05-2.46.47l-2.63-1.97a1.35 1.35 0 00-1.63 0l-3.19 2.4c-.51.38-1.17-.22-.82-.75l3.31-5.26c.53-.84 1.66-1.05 2.46-.47l2.63 1.97c.48.36 1.15.36 1.63 0l3.19-2.4c.51-.38 1.17.22.82.75z" />
    </svg>
  );
}

const ICONS: Record<Channel, (props: IconProps) => React.JSX.Element> = {
  whatsapp: WhatsAppIcon,
  instagram: InstagramIcon,
  facebook: MessengerIcon,
};

export function ChannelIcon({
  channel,
  className,
}: {
  channel: Channel | string;
  className?: string;
}) {
  const Icon = ICONS[channel as Channel] ?? MessengerIcon;
  return <Icon className={className} />;
}

/** Color de marca por canal (para badges y burbujas). */
export function channelColor(channel: Channel | string): string {
  switch (channel) {
    case "whatsapp":
      return "text-emerald-600";
    case "instagram":
      return "text-pink-600";
    case "facebook":
      return "text-blue-600";
    default:
      return "text-muted-foreground";
  }
}

export function channelLabel(channel: Channel | string): string {
  switch (channel) {
    case "whatsapp":
      return "WhatsApp";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Messenger";
    default:
      return channel;
  }
}
