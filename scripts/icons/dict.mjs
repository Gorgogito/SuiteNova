// English word of a Fluent icon name -> Spanish. An icon whose name has a word that is not here is left out of the catalog (better fewer icons than badly named ones).
const RAW = `
arrow=flecha text=texto document=documento right=derecha person=persona off=desactivado add=agregar left=izquierda multiple=múltiple circle=círculo table=tabla down=abajo up=arriba
checkmark=marca_de_verificación list=lista layout=diseño square=cuadrado column=columna sparkle=destello dismiss=cerrar edit=editar settings=configuración mail=correo calendar=calendario
bottom=inferior align=alinear top=superior desktop=escritorio search=buscar video=vídeo focus=enfoque link=vínculo phone=teléfono clipboard=portapapeles screen=pantalla chat=chat
window=ventana shield=escudo horizontal=horizontal people=personas image=imagen data=datos split=dividir row=fila clock=reloj slide=diapositiva two=dos vertical=vertical bullet=viñeta
folder=carpeta globe=globo_terráqueo book=libro one=uno weather=tiempo hint=sugerencia code=código star=estrella building=edificio prohibited=prohibido lock=candado call=llamada tab=pestaña
vehicle=vehículo location=ubicación sync=sincronizar center=centro database=base_de_datos cloud=nube subtract=restar rectangle=rectángulo dual=doble error=error double=doble play=reproducir
color=color toolbox=caja_de_herramientas line=línea tag=etiqueta page=página panel=panel border=borde bar=barra cube=cubo warning=advertencia heart=corazón chevron=ángulo card=tarjeta
task=tarea header=encabezado textbox=cuadro_de_texto in=dentro box=caja question=pregunta back=atrás open=abrir speaker=altavoz emoji=emoji four=cuatro direction=dirección rotate=girar
pulse=pulso home=inicio stack=pila keyboard=teclado cell=celda scan=escanear turn=giro briefcase=maletín forward=adelante landscape=horizontal three=tres position=posición mark=marca
alert=alerta space=espacio lines=líneas all=todo money=dinero share=compartir copy=copiar hand=mano app=aplicación cursor=cursor lightning=rayo target=diana controller=mando laptop=portátil
notebook=cuaderno bag=bolsa shifts=turnos apps=aplicaciones info=información board=tablero number=número note=nota pen=bolígrafo food=comida game=juego mic=micrófono usb=usb more=más
fit=ajustar clockwise=en_sentido_horario beaker=vaso_de_precipitados lightbulb=bombilla day=día eye=ojo pause=pausa camera=cámara caret=cursor_de_texto eraser=borrador brush=pincel
swipe=deslizar delete=eliminar save=guardar flash=flash resize=cambiar_tamaño inbox=bandeja_de_entrada presence=presencia shopping=compras autofit=autoajuste dashes=guiones curve=curva
expand=expandir branch=rama room=sala button=botón channel=canal ribbon=cinta plug=enchufe select=seleccionar key=llave flag=bandera font=fuente wave=onda sound=sonido receipt=recibo
sport=deporte grammar=gramática car=coche counterclockwise=en_sentido_antihorario sort=ordenar step=paso connected=conectado closed=cerrado checkbox=casilla flow=flujo accent=acento
group=grupo contract=contraer device=dispositivo drink=bebida filmstrip=tira_de_película gift=regalo style=estilo paint=pintura animal=animal title=título archive=archivo content=contenido
move=mover diagonal=diagonal to=a empty=vacío triangle=triángulo swap=intercambiar half=mitad math=matemáticas tap=tocar tree=árbol usage=uso meeting=reunión truck=camión shape=forma
drawer=cajón tablet=tableta grid=cuadrícula multiplier=multiplicador navigation=navegación picture=imagen port=puerto server=servidor voicemail=buzón_de_voz accessibility=accesibilidad
start=inicio print=imprimir width=ancho bidirectional=bidireccional maximize=maximizar paragraph=párrafo out=fuera wrap=ajuste battery=batería default=predeterminado microphone=micrófono
bookmark=marcador retail=comercio calculator=calculadora repeat=repetir mention=mención cellular=móvil underline=subrayado quote=cita contact=contacto view=vista crop=recortar desk=escritorio
percent=porcentaje door=puerta filter=filtro form=formulario new=nuevo glance=vistazo surface=superficie layer=capa offset=desplazamiento read=leer pin=chincheta record=grabar
notepad=bloc_de_notas team=equipo wrench=llave_inglesa puzzle=rompecabezas object=objeto thumb=pulgar simple=simple tools=herramientas profile=perfil clip=clip snow=nieve time=hora
badge=insignia distribute=distribuir end=final between=entre height=alto exclamation=exclamación download=descargar enter=entrar hook=gancho minimize=minimizar attach=adjuntar auto=automático
full=completo braces=llaves compare=comparar calligraphy=caligrafía sparkles=destellos switch=interruptor portrait=vertical fill=relleno highlight=resaltar background=fondo
communication=comunicación credit=crédito developer=desarrollador above=encima below=debajo dock=acoplar footer=pie_de_página queue=cola draw=dibujar drive=unidad leaf=hoja tool=herramienta
tracking=seguimiento stop=detener pride=orgullo dot=punto dots=puntos headphones=auriculares headset=casco hexagon=hexágono hourglass=reloj_de_arena quarter=cuarto account=cuenta
uppercase=mayúsculas megaphone=megáfono tv=televisor network=red padding=relleno_interno pipeline=canalización projection=proyección order=orden stream=transmisión abc=abc case=caso
indent=sangría proofing=revisión night=noche rain=lluvia wifi=wifi starburst=estallido airplane=avión evenly=uniformemente export=exportar barcode=código_de_barras scanner=escáner
bin=papelera recycle=reciclar compass=brújula template=plantilla thick=grueso bot=bot brain=cerebro fork=tenedor request=solicitud low=bajo bug=error_de_programa bank=banco week=semana
flip=voltear chart=gráfico history=historial shadow=sombra small=pequeño markdown=markdown formula=fórmula collections=colecciones single=único triple=triple gallery=galería
dialpad=teclado_de_marcación diamond=diamante short=corto flowchart=diagrama_de_flujo pill=píldora word=palabra span=intervalo status=estado update=actualizar equal=igual decrease=disminuir
increase=aumentar frame=marco gas=gas gauge=indicador guest=invitado hat=sombrero graduation=graduación ink=tinta stroke=trazo insert=insertar item=elemento reset=restablecer third=tercio
dash=guion live=en_vivo unread=sin_leer map=mapa format=formato mobile=móvil mountain=montaña and=y symbol=símbolo organization=organización password=contraseña plant=planta poll=encuesta
piece=pieza radar=radar type=tipo reading=lectura seat=asiento skew=sesgar tray=bandeja size=tamaño freeze=inmovilizar temperature=temperatura distributed=distribuido lowercase=minúsculas
wide=ancho character=carácter wand=varita middle=medio toggle=alternar translate=traducir trophy=trofeo cloudy=nublado sunny=soleado ad=anuncio fourth=cuarto console=consola zoom=zoom
snooze=posponer around=alrededor stretch=estirar rabbit=conejo generic=genérico store=tienda dotted=punteado exit=salir outline=contorno routing=enrutamiento shuffle=aleatorio trending=tendencia
backpack=mochila games=juegos letter=letra inside=dentro outside=fuera bowl=cuenco brightness=brillo high=alto activity=actividad feed=noticias broom=escoba government=gobierno agenda=agenda
month=mes work=trabajo cast=transmitir catch=capturar certificate=certificado check=verificar checked=marcado concentric=concéntrico clear=borrar formatting=formato caption=subtítulo
block=bloque coin=moneda comment=comentario component=componente cone=cono range=intervalo interim=provisional crown=corona currency=moneda dollar=dólar hover=pasar_por_encima cut=cortar
descending=descendente ascending=ascendente decimal=decimal remote=mando_a_distancia divider=separador tall=alto broken=roto scroll=desplazar signature=firma bottle=botella
pagination=paginación vibrate=vibrar earth=tierra sad=triste slight=ligero eyedropper=cuentagotas fast=rápido fingerprint=huella_digital progress=progreso flashlight=linterna fish=pez
bumper=parachoques trigger=gatillo gavel=mazo glasses=gafas point=punto haptic=háptico hard=duro hd=hd vr=realidad_virtual alt=alternativo guide=guía inking=entintado mouse=ratón
shift=mayúscula infographic=infografía local=local language=idioma rewind=rebobinar symbols=símbolos merge=combinar multiselect=selección_múltiple next=siguiente options=opciones
orientation=orientación bucket=cubo_de_pintura payment=pago community=comunidad available=disponible tentative=provisional front=frente premium=premium presenter=presentador
previous=anterior production=producción qr=qr quiz=cuestionario radio=radio rename=cambiar_nombre road=carretera router=enrutador scale=escala screenshot=captura send=enviar
exclude=excluir overlay=superposición sidebar=barra_lateral sign=señal smartwatch=reloj_inteligente cricket=críquet sticker=pegatina input=entrada output=salida street=calle cross=cruz
cells=celdas degree=grado justify=justificar asterisk=asterisco narrow=estrecho description=descripción effects=efectos roman=romano numeral=numeral dislike=no_me_gusta like=me_gusta
ticket=entrada timer=temporizador tooltip=sugerencia_emergente subway=metro trailer=remolque virtual=virtual wallet=cartera hail=granizo moon=luna partly=parcialmente showers=chubascos
shower=ducha whiteboard=pizarra
ltr=de_izquierda_a_derecha rtl=de_derecha_a_izquierda
x=x a=a g=g t=t
`;
export const DICT = Object.fromEntries(RAW.split(/\s+/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1).replace(/_/g, ' ')]; }));

// Categories: the first rule that has one of its words in the name wins. Names are Spanish; ids are stable.
export const CATEGORIES = [
  ['flechas', 'Flechas', 'arrow chevron caret swipe turn direction rotate flip swap sync'],
  ['personas', 'Personas y caras', 'person people contact profile guest account emoji hand thumb like dislike sad pride team community eye brain agents'],
  ['comunicacion', 'Comunicación', 'mail chat call phone megaphone comment mention send inbox voicemail communication mic microphone speaker headset headphones share mobile cellular'],
  ['documentos', 'Documentos y archivos', 'document folder clipboard notebook notepad note book archive drawer page receipt certificate bookmark paragraph template form'],
  ['texto', 'Texto y formato', 'text font bullet indent underline uppercase lowercase quote textbox grammar proofing abc calligraphy caption justify character'],
  ['tablas', 'Tablas y diseño', 'table layout column row cell cells grid panel border sidebar header footer padding divider split align distribute autofit resize slide frame'],
  ['datos', 'Datos y gráficos', 'data chart database server number percent calculator formula math poll infographic gauge pulse equal decrease increase pipeline'],
  ['negocios', 'Negocios y finanzas', 'briefcase money coin currency dollar payment credit wallet bank organization government building shopping bag retail store receipt ticket gift trophy badge'],
  ['tecnologia', 'Tecnología y dispositivos', 'desktop laptop tablet keyboard mouse screen device usb plug battery wifi bluetooth network router cloud code developer bug controller console remote smartwatch tv port printer print scanner barcode qr cube toolbox'],
  ['multimedia', 'Multimedia', 'video camera play pause record filmstrip image picture gallery speaker sound music stream cast'],
  ['tiempo', 'Calendario y tiempo', 'calendar clock timer hourglass day week month time history agenda'],
  ['naturaleza', 'Naturaleza y tiempo atmosférico', 'weather cloudy sunny rain snow moon night leaf plant tree mountain earth globe wave hail shower showers temperature animal fish rabbit'],
  ['transporte', 'Transporte y lugares', 'vehicle car truck airplane subway road street map location compass navigation home door room seat desk landscape'],
  ['comida', 'Comida y ocio', 'food drink bowl bottle fork game games sport cricket puzzle'],
  ['salud', 'Ciencia y salud', 'beaker lightbulb pill flashlight hat graduation quiz'],
  ['seguridad', 'Seguridad', 'lock shield key password fingerprint prohibited warning alert'],
  ['herramientas', 'Herramientas y dibujo', 'wrench tools tool pen brush eraser paint eyedropper ink inking draw crop cut copy scroll wand bucket'],
];
export const OTHER = ['simbolos', 'Símbolos y señales'];
