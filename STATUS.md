# Estado de la entrega — 19 octubre 2026

Primera versión funcional construida desde cero. Alcance de producto reducido explícitamente en PLAN.md y en Ajustes: no hay nube, API de IA, APK ni formatos adicionales.

Verificación ejecutada: 37 pruebas aprobadas con `node --test tests/*.test.cjs`, incluidas 18 del programador, 10 del Tester del motor, 6 del Tester del transporte simulado y 3 DOM por el Manager. El harness DOM utiliza linkedom; no sustituye un navegador real. Checks de sintaxis de los cuatro módulos pasan.

Se corrigieron semilla repetida, costes ausentes tratados como gratuitos, excepción de copias Nazgûl, repetición de hello consumiendo asientos, texto incorrecto de Rat Colony y propietario perdido al traducir una carta.

QA independiente del motor inicial APROBADA por Tester. Extensión de efectos y pruebas DOM verificadas por Manager, sin revisión independiente completa final. Transporte validado con PeerJS simulado. Browser QA no disponible: no se ejecutó prueba visual Android ni partida sobre WebRTC real. Scryfall/Archidekt pueden fallar por conectividad/CORS y tienen mensajes de recuperación.

Despliegue inicial: sitio privado del propietario. El acceso de amigos requiere que el propietario los autorice en el sitio o que publique public/ en otro hosting accesible. Código y ZIP preparados para GitHub Pages. No contiene claves privadas de API ni tokens de repositorio.

Siguiente verificación de producto: abrir en Android y PC, comprobar tamaño de controles y una mesa entre dos conexiones reales; ajustar si la red necesita un servidor TURN.

## Corrección 0.2 — 19 octubre 2026

Causa confirmada de importación: respuesta Archidekt con Access-Control-Allow-Origin distinto al sitio. Migración de hosting estático a Worker ESM de Sites para consultar exclusivamente decks públicos mediante ruta fija. Arte de práctica descargado y verificado como JPEG. UI usa imágenes para cartas antiguas sin migración destructiva. Pruebas del importador, servidor y DOM agregadas; 55 pruebas aprobadas en total, incluidas 13 del importador y 5 del servidor. El Worker devuelve únicamente datos necesarios del deck, sin perfil del propietario.

## Corrección en producción y playmat 0.3

502 reproducido en producción. La consulta usaba redirect:error; se cambió a redirect:manual compatible con el runtime, sin seguir redirecciones. Verificación HTTP real posterior: /api/archidekt/1 respondió 200 con 17 entradas; conversión a un comandante y 16 cartas con imágenes. Se comprobó también una imagen de esa impresión, HTTP 200 image/jpeg. Las comprobaciones simulan interfaz DOM, no navegador real. Rediseño playmat terminado. Tester independiente: APROBADO funcionalmente, 58/58 pruebas sin omisiones. Regresiones cubren índices intercalados del campo, privacidad DOM con ocho jugadores, biblioteca, cementerio, exilio, comandante, fases y turnos. CSS inspeccionado para tamaños móviles; no se midió layout real ni se validó visualmente en Android por falta de navegador.

## Maná y Tips 0.4 — 20 octubre 2026

APROBADO por Tester independiente: 64/64 pruebas sin omisiones. TAP genera una unidad de maná de tierra sencilla al pasar de enderezada a girada; estado explícito, idempotencia de acciones, enderezar y opción manual evitan duplicación. Bots reutilizan esa producción. UI muestra el color previsto, permite girar sin maná y ajustar reserva. Tips contextual local según fase/turno/pila/combate/reserva, sin leer manos rivales ni mutar la partida. Tutorial actualizado. Build Worker ESM correcto. Browser QA no disponible; no se afirma validación visual Android.

## Juego virtual 0.5 — 20 octubre 2026

APROBADO por Tester independiente: 86/86 pruebas sin omisiones. Pago automático con previsualización de tierras/reserva, impuesto, rechazo de plan obsoleto y operación atómica. Ronda opcional de confirmaciones por participante vivo; nuevos hechizos reinician pases, bots esperan. Prueba P2P adicional verifica que falsificar actorId no permite gastar tierras ni confirmar por el anfitrión. UI: distintivo de maná disponible, inspector de pila, aviso contextual, mano plegable, tamaños, atacantes visuales y resumen de daño de comandante. Preferencias locales sin mutación de partida; vistas públicas sin identidades ocultas. Investigación en RESEARCH.md. Build Worker ESM correcto. No se ejecutó navegador ni WebRTC real; la validación visual Android sigue pendiente. Prioridad completa, costes complejos y efectos externos siguen manuales.

## Reglas, bots, red y móvil 0.6 — 23 octubre 2026

93 pruebas aprobadas con `node --test tests/*.test.cjs` y 1 omitida (la de interfaz DOM necesita `npm install`); se añadieron 6 de red y 14 de reglas (la prueba de tierras duales se actualizó porque ahora sí pagan). Nuevo `src/effects.js` (lector de texto Oracle conservador) y `src/bots.js` (bots deterministas con información pública). Combate con bloqueadores y daño a criaturas en el motor; `DECLARE_BLOCKS` para el defensor. Red: latido, reintentos con espera creciente, acuse de acciones y reenvío idempotente, token en localStorage y reapertura de sala por el anfitrión. Prueba de estrés: cuatro bots juegan una partida completa sin errores ni cartas perdidas.

Revisión visual real en Chromium móvil (390×844 y 360×760): sin desbordes de página ni botones táctiles menores de 36 px en inicio, decks, editor y mesa; probado tierra dual, objetivo de Rayo, ataque y bloqueo del bot. Pendiente: Android físico y partida WebRTC entre dos redes reales.
