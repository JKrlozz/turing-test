# Experimento Test de Turing

Prueba local con dos conversaciones consecutivas y respuestas de voz, para un evaluador y un operador en la misma red.

## Arranque

Requiere Node.js 20 o superior, acceso a internet y cuentas con saldo/permisos en OpenAI y Cartesia.

1. Ejecuta `npm install` si faltan dependencias.
2. Configura `.env` siguiendo `.env.example`: `OPENAI_API_KEY`, `OPENAI_MODEL`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` y `CARTESIA_MODEL`.
3. Ejecuta `inciar.bat` en Windows o `npm start`. El BAT abre el operador en el puerto 3000; si cambias `PORT`, abre manualmente la URL correspondiente.
4. Abre `http://localhost:3000/operador` en el servidor y `http://IP-DEL-SERVIDOR:3000/evaluador` en el otro equipo. Permite Node.js en la red privada del firewall.

El modelo de texto predeterminado es `gpt-4o-mini`. Ambas partes usan `sonic-3` y la voz Joselin, definida en `CARTESIA_VOICE_ID`. El servidor llama a Cartesia mediante `/tts/bytes`, genera MP3 y mantiene las credenciales fuera del navegador. Sin claves configuradas no permite iniciar; no sustituye los proveedores por respuestas falsas.

## Flujo

1. El operador configura una identidad ficticia compartida y confirma que esta listo. Ya no configura preguntas.
2. Antes de comenzar, el evaluador debe pensar cinco preguntas para repetir en ambos chats.
3. Primero conversa con Chat A y luego con Chat B. Se sortea que chat corresponde al humano en cada nueva sesion.
4. El evaluador escribe cinco mensajes libres por chat, uno por turno. Solo recibe audio y puede reproducirlo de nuevo mediante el reproductor. No recibe transcripciones de las respuestas.
5. El humano escribe desde el operador. Ambas fuentes pasan por la misma voz de Cartesia. La IA espera aleatoriamente entre 10 y 20 segundos ANTES de pedir su respuesta a OpenAI; luego se suma el tiempo de generacion de texto y audio.
6. Las respuestas tienen un maximo de 35 palabras. El servidor rechaza respuestas humanas mas largas y limita tambien las de IA.
7. Tras el quinto audio aparece el boton para continuar al segundo chat o a la seleccion final. El evaluador elige Chat A o Chat B como persona real y entonces se le indica cual era la persona real, sin estadisticas ni justificacion. La identidad de cada chat permanece oculta hasta registrar la eleccion.

Los errores de generacion permiten reintentar el mismo turno sin consumir otra pregunta. Recargar/reconectar recupera el estado mientras siga activo el servidor. Cada respuesta muestra el nombre del chat sobre un boton para reproducir o pausar. Las respuestas nuevas intentan reproducirse automaticamente al llegar; si el navegador lo bloquea, aparece un aviso para pulsar el boton. Los audios del historial no se reproducen automaticamente al recargar o reconectar.

Durante la espera, ambos chats muestran un indicador de escritura con pausas aleatorias. Es una animacion simulada, no una transmision de las pulsaciones del operador; se detiene al recibir la respuesta, ante un error o al desconectarse. El operador ve siempre que chat le corresponde y responde desde su propio formulario.

## Privacidad y limites

- Usa solo identidades ficticias y una voz para la que tengas autorizacion. Los textos humanos se envian a Cartesia; las preguntas e identidad del chat IA se envian a OpenAI y sus respuestas a Cartesia.
- `.env` esta excluido de Git. No publiques claves. Si una clave se comparte en una conversacion o fuera del equipo, conviene revocarla y reemplazarla.
- Existe una unica sesion compartida, sin autenticacion de participantes. Usa una red de confianza y no expongas el puerto a internet. El evaluador no debe abrir la pantalla del operador; la separacion de pantallas no impide a un usuario tecnico solicitar ese rol.
- Las conversaciones, audios y eleccion solo se conservan en memoria hasta iniciar otra sesion o reiniciar el servidor. Ya no se generan los registros JSON antiguos ni estadisticas; los archivos historicos existentes no se borran.
- Las URL de audio son identificadores aleatorios, sin texto ni identidad del interlocutor. Expiran al sustituir la sesion. Quien tenga una de estas URL puede escuchar ese audio mientras la sesion exista.

## Verificacion

Ejecuta `npm test`. Las pruebas usan proveedores simulados, sin gasto de API: ambos ordenes, cinco turnos por chat, limites, espera previa, audio, errores/reintentos, reconexion y seleccion unica. No sustituyen una prueba con las credenciales reales y reproduccion en ambos equipos.
