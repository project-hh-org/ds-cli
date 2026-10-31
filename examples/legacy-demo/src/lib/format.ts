import { format, formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

export function formatWon(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export function formatDate(iso: string): string {
  return format(new Date(iso), "yyyy.MM.dd HH:mm");
}

export function formatRelative(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ko });
}

export function maskPhone(phone: string): string {
  return phone.replace(/(\d{3})-(\d{3,4})-(\d{4})/, "$1-****-$3");
}

export function percent(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}
