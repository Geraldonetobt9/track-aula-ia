import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Mensagem legível de um erro qualquer vindo de um catch. */
export function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
}
