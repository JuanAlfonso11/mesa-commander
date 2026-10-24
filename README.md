# Mesa Commander

App de fans de Magic: The Gathering, Commander de mesa libre. Interfaz española, móvil y PC. No afiliada con Wizards of the Coast.

## Uso

Abre la web publicada, pulsa **Crear una mesa**, elige deck y mesa local con bots. Abre cartas de tu mano para jugar tierras o lanzar hechizos. Acuerda prioridad y resuelve la pila; aplica los efectos manualmente. **Jugar turno del bot** ejecuta un turno, pausando para confirmar bloqueos. El daño a criaturas y habilidades especiales se resuelve manualmente. El primer turno requiere pulsar Robar; los siguientes roban al pasar turno.

Los dos decks incluidos son listas de laboratorio sencillas, no precons ni recomendaciones competitivas. Usan excepciones de copias de Rat Colony y Persistent Petitioners. Los resúmenes offline son explicaciones propias, no texto Oracle actualizado.

**Mis decks** permite búsqueda online Scryfall, cambiar comandante, añadir/quitar cartas, validar construcción básica y exportar lista. Usa un bloque `Commander` seguido de `Deck` al importar. La versión alojada importa Archidekt mediante una ruta propia del servidor (/api/archidekt/ID), evitando el bloqueo CORS del navegador. Preserva las ediciones y sus imágenes y respeta categorías excluidas. Los decks privados no se importan sin una exportación proporcionada por su dueño. EDHREC y Moxfield se abren en sus sitios. No se promete acceso a todas sus listas ni a decks privados.

**Online:** anfitrión prepara una sala y comparte el código de 8 caracteres. Los invitados eligen su deck y se unen. El anfitrión inicia y los asientos libres se convierten en bots. El anfitrión ve todo el estado; los invitados reciben solo mano propia y datos públicos. No es una plataforma competitiva contra trampas. La señalización usa PeerJS público y puede fallar por NAT/red móvil. No hay TURN propio. El código da acceso a asientos libres. Reconexión usa token de sesión del mismo navegador mientras la sala original exista. Al salir el anfitrión, la mesa se desconecta; conserva un guardado local recuperable. No hay migración automática.

## Ejecutar / distribuir

`node build.cjs` genera `public/index.html`. `npm run build` genera además el Worker con todos los archivos incluidos para el alojamiento Sites. La aplicación conserva una entrada HTML, y el servidor agrega únicamente la consulta de decks públicos de Archidekt. Para GitHub Pages publica `public/`: allí no existe la ruta del servidor y la importación por enlace puede volver a estar limitada por CORS; utiliza la lista exportada. Abrir solo el HTML local sirve para funciones locales; PWA y multijugador deben servirse vía HTTPS.

`node --test tests/*.test.cjs` ejecuta pruebas. No requiere instalar dependencias para el motor. Para incluir las pruebas de interfaz DOM, ejecuta `npm install` (dependencia de desarrollo: linkedom). Sin esa dependencia, esas pruebas se omiten explícitamente.

Android: menú del navegador → Instalar aplicación / Añadir a pantalla de inicio. No se ha generado APK ni publicado en Play Store. El sitio de demostración privado requiere acceso de su propietario; para que amigos entren al mismo sitio, publícalo con audiencia apropiada o usa GitHub Pages. Mantén el código de sala entre invitados.

## Datos y límites

localStorage conserva decks, historial y partida anfitriona/local. Exporta respaldo antes de borrar datos del navegador. Los respaldos completos contienen cartas ocultas. Las imágenes de las seis cartas de práctica se incluyen localmente. Las imágenes de otras cartas requieren internet; los nombres y metadatos guardados se conservan offline. La caché PWA mantiene la interfaz tras la primera visita si el navegador permite registrar el service worker.

Reglas de Commander: https://magic.wizards.com/es/formats/commander · Reglas completas: https://magic.wizards.com/en/rules · Datos: https://scryfall.com · PeerJS: https://peerjs.com (MIT).

Esta versión no incluye: cuenta/nube, IA interna, Standard/Brawl/Draft, motor completo de reglas, múltiples comandantes ni pago híbrido automatizado. Ver PLAN.md. El asistente es un glosario local y prepara preguntas para Claude; no simula respuestas de IA.

## Actualización 0.2 — arte e importación

Las cartas de los decks de práctica y las manos guardadas muestran arte sin modificar sus datos. El importador preserva el UUID de impresión y las imágenes de Archidekt. Las cartas de doble cara incluyen vista reversa cuando la edición tiene reverso propio. Errores de deck privado, inexistente, límites o respuesta no válida muestran instrucciones concretas.

## Mesa visual tipo playmat

Los rivales aparecen arriba con sus vidas y campos públicos. Tu campo separa criaturas, tierras y otros permanentes; esta distribución es visual y no añade restricciones de reglas. La biblioteca, zona de mando, cementerio y exilio están identificados, con sus conteos. La mano queda debajo del campo y se desplaza horizontalmente si no cabe. Toca una carta para abrir sus acciones; toca el dorso de tu biblioteca para robar. Registro y chat se encuentran bajo el tapete.

El servidor de importación utiliza redirección manual compatible con el alojamiento y no sigue redirecciones externas. Se verificó una consulta real de Archidekt desde el sitio publicado, incluida la conversión de cartas e imagen. La interfaz se verifica con pruebas DOM; falta revisión visual en navegador Android y partida WebRTC entre dispositivos reales.

## Tierras y tips (0.4)

Al girar una tierra básica (incluidas nevadas y Wastes) o una tierra cuyo único texto sea `{T}: Add {X}.` para un solo tipo de maná, se añade automáticamente una unidad a la reserva. Jugarla no produce maná; enderezarla tampoco. Las tierras criatura, de varias caras, con elecciones o costes/condiciones permanecen manuales. Los efectos externos que alteren la producción no se interpretan. La acción Girar sin maná y el botón Ajustar permiten gestionar excepciones. Los bots utilizan la misma acción para no duplicar producción.

Tips, en la cabecera de la mesa, abre consejos locales según fase, turno, tierras jugadas, reserva, pila y combate. Incluye ayuda de acciones y enlace a la guía oficial de Magic; no es una API de IA. Tutorial de maná actualizado.

## Interacciones de juego virtual (0.5)

Inspiradas en las guías oficiales de Arena y MTGO (ver RESEARCH.md):

- Abre un hechizo y pulsa **Revisar pago automático**. Verás las tierras que se girarán, el impuesto y la reserva restante. Confirma para pagar y lanzar en una sola acción. El plan caduca si cambia la mesa; vuelve a revisarlo. Se limita a costes simples y fuentes de un solo maná. Comprueba otros aumentos, descuentos y condiciones manualmente.
- **Maná disponible** destaca cartas propias cuyo coste impreso puede cubrirse; no verifica que sea legal lanzarlas en ese momento.
- En **La pila**, activa **Ronda de respuestas**. Cada jugador vivo debe pulsar **Paso** antes de que el jugador activo resuelva. Una nueva respuesta reinicia los pases. El anfitrión confirma bots; estos se detienen con la pila pendiente. Se puede desactivar la ronda para gestionar excepciones de mesa libre. No sustituye un motor de prioridad completo.
- Toca un hechizo de la pila para leerlo. **¿Qué sigue?** muestra el estado de la acción pendiente.
- **Vista** ajusta el tamaño de tus cartas. **Ocultar mano / Ver mano** pliega tu mano; estas preferencias solo afectan a tu dispositivo.
- **Atacar** ofrece imágenes, selección de criaturas disponibles y limpieza de selección. Los bloqueos complejos siguen siendo manuales.
- **Resumen** reúne vidas, veneno, número de cartas y daño de comandante recibido, sin mostrar cartas ocultas.

## Efectos, bots, red y móvil (0.6)

**Efectos automáticos.** La app lee el texto Oracle de cada carta y aplica sola los efectos que reconoce: robar, ganar o perder vidas, daño a cualquier objetivo o a cada criatura/oponente, destruir, exiliar o devolver a la mano, destruir todas las criaturas, contrarrestar hechizos, crear fichas, contadores +1/+1, buscar tierras básicas y avisos de adivinar/vigilar. También las habilidades «Cuando entra» de criaturas que no dependan de una elección. Si una carta tiene una sola frase que no entiende, toda la carta queda manual (marca «Manual» en la pila). Al resolver, la app te pide los objetivos; los rivales aparecen primero.

**Maná.** Tierras duales (Steam Vents, Watery Grave…), Command Tower y artefactos sencillos (Sol Ring, Arcane Signet, Mind Stone) producen maná al girarlos: si hay varios colores, eliges con un botón. El pago automático los usa y reserva las fuentes flexibles para los colores que nadie más cubre. Tierras de dolor, maná restringido y criaturas de maná siguen manuales.

**Combate.** El defensor elige un bloqueador por atacante (los bots lo hacen solos). Al aplicar el daño se resuelven criaturas que bloquean, dañar primero, dañar dos veces, arrollar, toque mortal, vínculo vital, volar/alcance, amenaza, defensor e indestructible. El comandante que muere o se exilia vuelve a la zona de mando. «Solo daño al jugador (manual)» conserva el modo anterior.

**Bots.** Eligen la tierra que les da los colores que necesitan, lanzan lo más valioso que pueden pagar (sin girar tierras de más), usan removal contra la mayor amenaza, guardan contrahechizos, no atacan donde perderían la criatura sin matar al bloqueador, rematan al rival débil, dejan defensores si les pueden matar y bloquean bien o se sacrifican solo cuando el golpe es peligroso. Solo usan información pública y su propia mano.

**Online.** El anfitrión envía un latido cada 5 s. Si un invitado pierde la conexión, la app reintenta sola durante unos 3 minutos y reenvía las acciones que no llegaron (no se aplican dos veces). El token del asiento se guarda en el navegador, así que cerrar la pestaña no te quita el asiento. Si el anfitrión recarga o sale, en Inicio aparece **Reabrir sala**: misma sala, mismo código, y los invitados vuelven solos. Sigue sin haber servidor TURN propio.

**Móvil.** Barra fija abajo con fase, mano, maná, pila y la acción principal (Fase →, Resolver, Aplicar daño, ▶ Bot). En el teléfono el orden es: rivales → tu asiento → tu campo → tu mano → zonas → maná y pila. Botones táctiles de 42–44 px, barra de herramientas desplazable y acciones fijas al pie de los diálogos.

## Importar desde Archidekt en GitHub Pages

Archidekt solo permite que su API la lean páginas de `localhost:3000`, y GitHub Pages no tiene servidor propio. Por eso la app usa un servicio pequeño en Cloudflare Workers: `https://mesa-commander-api.jaab0001.workers.dev/api/archidekt/ID`. Solo lee decks públicos por número, no envía cookies, quita los datos del dueño y responde con CORS únicamente a `juanalfonso11.github.io` y `localhost`. El código está en `proxy/worker.js` (para `npx wrangler deploy` desde `proxy/`) y la dirección se configura en `src/shell.html` (`MESA_CONFIG.archidektProxy`). Si el servicio falla, la importación por texto sigue funcionando.
