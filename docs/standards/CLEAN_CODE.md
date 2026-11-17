# Estándar obligatorio de ingeniería y documentación de código

**Versión:** 0.2.0 · **Estado:** APROBADO por el propietario · **Idioma de comentarios:** español.

## 1. Principio

**No debe existir código sin una finalidad comprensible.** Priorizar nombres descriptivos, funciones pequeñas, tipos explícitos, separación de responsabilidades, efectos visibles, manejo de errores y pruebas. Los comentarios complementan el código, nunca reemplazan una estructura clara.

-Evitar sobreingenieria si no es necesario.

## 2. Documentación en español obligatoria

Toda **función**, **función flecha asignada**, **callback/handler** (incluidas funciones anónimas con lógica relevante), **método** (público/privado), **getter/setter**, **clase**, **constructor relevante**, **componente React**, **hook**, **servicio**, **adaptador**, **controlador/endpoint** y **contrato de interfaz/exportado** debe contar con explicación JSDoc/TSDoc en español. Para funciones anónimas inline que no permiten comentario JSDoc útil, **extraer una función con nombre y documentación**; no se permite dejar lógica sin explicar.

Documentar como mínimo:

- **Propósito y reglas relevantes**: qué responsabilidad resuelve y por qué es necesario.
- `@param`: cada argumento no evidente y el contrato esperado (evitar repetir obviedades sin utilidad).
- `@returns`: resultado y significado, si devuelve valor o Promise.
- `@throws` o `@remarks`: fallos de dominio, efectos secundarios, red/transacciones/permisos, cuando aplique.
- En clases: responsabilidad, límites del estado y dependencias relevantes. En componentes: datos mostrados y efectos/interacciones.

Ejemplo orientativo:

```ts
/**
 * Resuelve un proveedor en la sociedad y ambiente SAP de una factura.
 * No aplica filtros de vigencia distintos a la existencia del registro.
 *
 * @param conexion - Conexión autorizada al cliente seleccionado.
 * @param rfcEmisor - RFC normalizado del emisor del CFDI.
 * @param sociedad - Clave de sociedad obtenida del catálogo del cliente.
 * @param ambienteSap - Ambiente SAP obtenido de la sociedad.
 * @returns Identificador del proveedor encontrado de forma inequívoca.
 * @throws ErrorDeDominio si no existe o hay múltiples coincidencias en ese contexto.
 */
async function resolverProveedor(
  conexion: ConexionLectura,
  rfcEmisor: string,
  sociedad: string,
  ambienteSap: string,
): Promise<string> {
  // Implementación solo de ejemplo: la consulta se define tras validar el DDL.
  throw new Error('Pendiente de implementación verificada');
}
```

El ejemplo **no debe usarse en producción**. No documentar como ejecutado un método sin implementar.

### Comentarios internos

- Deben explicar la **razón** de una condición especial, límite, invariantes, comportamiento fiscal, autorización o conciliación; no escribir comentarios redundantes como «incrementa i».
- Variables, esquemas JSON, estados, flags y configuraciones con semántica no evidente incluyen descripción en español en su tipo, declaración o documento adyacente.
- SQL y migraciones internas: comentario inicial indicando alcance, tablas afectadas, propósito y rollback. Nunca migraciones al esquema del cliente sin aprobación.
- En tests, describir el escenario y el resultado esperado en español. Los identificadores de código y protocolos pueden estar en inglés cuando sea estándar idiomático.
- La documentación debe mantenerse actualizada en el mismo cambio de código. Todo comentario desfasado es defecto que bloquea la entrega.

## 3. Reglas de diseño

- SRP, cohesión alta y acoplamiento bajo; módulo RF-1 no importa implementación interna de módulos futuros.
- Capas: dominio puro -> casos de uso -> puertos/interfaces -> adaptadores de infraestructura -> controladores/API -> componentes UI.
- Dependency injection para broker, reloj, auditoría y parser; no usar conexiones globales compartidas entre clientes.
- No funciones monolíticas ni lógicas repetidas: helpers pequeños cuando tengan responsabilidad clara. No agregar abstracciones especulativas.
- TypeScript `strict` y validación runtime de entradas y respuestas remotas. No `any` injustificado, no `as` que silencie fallos de contratos.
- Errores de dominio con **código estable**; texto visible en español, sin credenciales, SQL o stack traces.
- Uso de consultas parametrizadas, transacciones acotadas, abortos/timeouts, decimal exacto para montos y claves de idempotencia.
- Nunca comentar para disimular implementación insegura o incompleta: bloquear tarea y registrar pendiente.

## 4. Calidad y revisión de agentes

Antes de declarar HECHO el agente comprueba y registra en `WORKLOG.md`: `lint`, `format:check`, `typecheck`, tests unitarios/integración correspondientes, build, revisión de secretos y de cobertura de comentarios. Si algún comando todavía no existe, registrar **NO EJECUTADO**; no inventar resultado. El repositorio deberá incorporar posteriormente un chequeo reproducible de documentación (`eslint` o script AST) que marque declaraciones sin JSDoc y excepciones justificadas, sin deshabilitar reglas para «pasar CI».

Revisión humana obligatoria para escrituras productivas, cambios de autenticación, credenciales, permisos, infra y migraciones de BD interna. Todo PR debe incluir una explicación empresarial en español de la solución, decisiones y riesgos.
