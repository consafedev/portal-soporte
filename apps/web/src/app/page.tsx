import { redirect } from 'next/navigation';

/**
 * Envía la ruta raíz al dashboard, cuya capa de sesión redirige al login si hace falta.
 *
 * @returns No devuelve interfaz; Next.js ejecuta la navegación hacia login.
 */
export default function Page(): never {
  redirect('/dashboard');
}
