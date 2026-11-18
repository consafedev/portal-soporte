import { redirect } from 'next/navigation';

/**
 * Envía la ruta raíz a la pantalla de autenticación sin crear un dashboard.
 *
 * @returns No devuelve interfaz; Next.js ejecuta la navegación hacia login.
 */
export default function Page(): never {
  redirect('/login');
}
