# Experimento Test de Turing

Aplicación local para realizar un experimento con dos laptops en la misma red WiFi o Ethernet.

## Requisitos

- Node.js 18 o superior.
- Una clave de API de OpenAI para la laptop servidor.
- Ambos equipos conectados a la misma red local.

## Instalación y arranque

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` como `.env` y completa `OPENAI_API_KEY`. Puedes cambiar `OPENAI_MODEL` y `OPENAI_MAX_TOKENS` sin editar el código.

3. Inicia el servidor:

   ```bash
   npm start
   ```

En Windows también puedes ejecutar `inciar.bat`. El archivo instalará las dependencias si faltan, creará `.env` desde `.env.example` si aún no existe, abrirá una ventana para el servidor y lanzará automáticamente la pantalla del operador.

4. En la consola aparecerán las URLs de red. En la laptop del evaluador abre `http://localhost:3000/evaluador` o la URL local indicada.

5. En la segunda laptop abre la misma URL de red, pero con `/operador`, por ejemplo `http://192.168.1.25:3000/operador`.

La aplicación usa reconexión automática de Socket.io. Si Windows Firewall pregunta, permite conexiones entrantes para Node.js en la red privada. No expongas el puerto a internet.

## Flujo del experimento

- El evaluador puede iniciar directamente. Si pulsa **Instrucciones**, el botón de inicio se pausa mientras termina la voz local de Web Speech API y la transcripción aparece en pantalla.
- El operador cambia nombre, edad y ciudad, edita la cantidad de preguntas y pulsa **Confirmar que estoy listo**. El evaluador no puede iniciar antes de esa confirmación.
- El servidor crea una identidad y sortea qué lado es la IA en cada sesión.
- La respuesta humana puede aparecer primero de forma aleatoria. La IA mantiene un mínimo de 7 segundos en su modo rápido y, si el operador respondió dentro de esa ventana, agrega una espera aleatoria de 2 a 5 segundos.
- Al terminar, el evaluador elige A o B, escribe su justificación y puede ajustar la cantidad de preguntas. Si agrega preguntas, la sesión continúa con ellas.

## Registros

Cada sesión se escribe como JSON en `data/sesiones/` con identidad, asignación, preguntas, respuestas de ambos lados, tiempos, elección y justificación. La carpeta se crea automáticamente al iniciar.

## Seguridad y modo de prueba

`.env` nunca se envía al navegador. Si se arranca sin `OPENAI_API_KEY`, la aplicación usa una respuesta local de prueba y lo avisa en la consola; esto permite probar la conexión y la interfaz, pero no debe usarse para resultados reales.

La voz de instrucciones es generada por el navegador y no necesita internet. El resto de la interfaz, React y Socket.io se sirve desde la laptop servidor.
