# Mesa Commander

Objetivo: web de mesa libre de Commander en español para móvil y PC. Autorización: crear desde cero; ampliar funciones por etapas. Publicación inicial privada con Sites.

Arquitectura: src/core.js motor puro, src/data.js datos e importación, src/network.js anfitrión autoritativo PeerJS, src/ui.js interfaz. build.cjs agrupa en public/index.html. PWA añade manifest, icono, service worker; PeerJS está empaquetado localmente. No se almacenan claves API.

Entregado en primera versión: mazos de laboratorio offline, constructor y búsqueda Scryfall, listas de texto, importación Archidekt con fallo recuperable, mesa manual, bots limitados, pila, combate confirmado, P2P con vistas privadas, guardado local, historial, ligas casuales, glosario y ayuda para consultar Claude.

Pendientes explícitos: cuentas y sincronización en nube, API de IA integrada, APK/Play Store, validación de formatos distintos a Commander, draft, segundo comandante, adjudicación completa de habilidades y reglas, migración automática del anfitrión, TURN propio. Ninguno se presenta como funcional.

Prioridades posteriores: 1) prueba Android y dos redes reales; 2) mejorar bots y sistema de efectos; 3) persistencia autenticada y reconexión durable; 4) IA interna con credenciales y presupuesto acordados; 5) Android distribuible y formatos adicionales.

Criterios actuales: sin fugas de manos rivales a clientes, cambios atómicos del motor, conservación de inventario, persistencia tras acciones, fallos remotos visibles, interfaz responsive, sin ficticia IA/nube.

Corrección 0.2: servidor Worker ESM con ruta fija Archidekt; frontend y arte local embebidos en el despliegue. Public/ continúa disponible como distribución estática, con limitación CORS en GitHub Pages sin servidor auxiliar.

Iteración 0.3: mesa tipo playmat con rivales arriba, campo propio por tipos de permanente, mano inferior, zonas de biblioteca/cementerio/exilio/comandante y controles de pila/maná. Preservar acciones, índices originales del campo, privacidad y guardados. QA funcional por DOM; revisión visual Android pendiente por falta de navegador disponible.

Iteración 0.4: generación atómica de maná en TAP para tierras sencillas, opción manual, bots reutilizando producción, ajustes de reserva y tips contextuales dentro de la mesa. Preservar estado/red/privacidad.

Iteración 0.5: investigación oficial Arena/MTGO documentada en RESEARCH.md; pago automático con vista previa, ronda de respuestas optativa, inspección de pila, indicación de coste cubierto, aviso contextual, mano plegable, tamaño de cartas, selección visual de atacantes y resumen de daño de comandante. Mantener mesa libre y límites explícitos.

Iteración 0.6: efectos desde texto Oracle con objetivos, tierras duales y artefactos de maná, combate con bloqueadores y daño a criaturas, bots con criterio (tierra, valor, objetivos, ataque seguro, bloqueos), red resistente (latido, reconexión automática, reenvío, reapertura de sala) y mesa móvil con barra de acciones. Mantener mesa libre: lo que no se reconoce queda manual.
