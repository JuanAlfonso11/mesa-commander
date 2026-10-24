# Referencias de juego virtual — 20 octubre 2026

Se revisaron guías oficiales de MTG Arena y Magic Online. Se toman patrones de interacción; no se reutiliza su código ni su arte de interfaz.

| Patrón observado | Fuente oficial | Adaptación en Mesa Commander 0.5 |
| --- | --- | --- |
| Mano desplegable, selección táctil, controles de maná | [Arena móvil: State of the Game enero 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21) | Mano que se oculta/despliega, cartas de tamaño ajustable, selector visual de atacantes |
| Previsualización de fuentes antes de pagar | [Arena: The Brothers’ War](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-the-brothers-war) | Plan visible con tierras propias que se girarán y reserva restante; confirmación atómica ligada a la revisión de la mesa |
| Ventanas de decisión, paradas y prioridad | [MTGO Tips & Tricks](https://www.mtgo.com/getting-started/getting-started-tips-tricks) y [Gameplay](https://www.mtgo.com/getting-started/getting-started-gameplay) | Aviso «¿Qué sigue?» y ronda opcional de confirmaciones antes de resolver el hechizo superior |
| Campos rivales y daño de comandante visibles | [MTGO Multiplayer](https://www.mtgo.com/getting-started/getting-started-multiplayer) | Playmat existente y nueva tabla de vidas, veneno, tamaño de mano y daño de comandante por origen |

## Alcance técnico

El pago usa el coste impreso y el impuesto de comandante. Acepta símbolos numéricos y W/U/B/R/G/C, usa primero reserva y solo gira tierras simples mono. El distintivo «Maná disponible» indica cobertura de ese coste, no legalidad del lanzamiento. No calcula aumentos/descuentos, efectos externos, costes alternativos, híbridos o X. Se rechazan costes adicionales explícitos y ciertos mecanismos especiales; el jugador conserva pago manual.

La ronda de respuestas está desactivada de forma predeterminada y conserva esa conducta en guardados antiguos. El jugador activo puede activarla. Cada participante vivo confirma su pase; una respuesta nueva o la resolución del hechizo superior reinicia las confirmaciones. Los clientes remotos solo confirman su propio asiento. El anfitrión confirma bots a mano. No es una implementación completa de prioridad, habilidades disparadas ni acciones basadas en estado.

No se añaden concesiones automáticas, temporizadores que consuman el turno ni respuestas automáticas de rivales. Los bots mantienen sus límites y se detienen si la nueva ronda impide resolver. Las preferencias visuales son locales y no alteran la partida. El resumen no revela identidades de manos o bibliotecas.

## Funciones que siguen pendientes

Motor completo de reglas y efectos, asignación de bloqueadores por bots, pila de habilidades, gestión por comandante individual cuando hay varios, prioridad completa por pasos, nube/cuentas, aplicación APK y comprobación visual real en Android. La app conserva mesa libre, persistencia local y P2P.
