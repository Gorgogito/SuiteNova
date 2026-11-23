// More words (the less frequent ones) and the extra words that decide the category.
const RAW = `
access=acceso on=activado section=sección effect=efecto landing=aterrizaje take=tomar album=álbum urgent=urgente straighten=enderezar cat=gato dog=perro paw=huella_de_pata turtle=tortuga recent=reciente
detail=detalle bounce=rebote eject=expulsar import=importar join=unirse inward=hacia_dentro upload=cargar arrows=flechas autocorrect=autocorrección autosum=autosuma backspace=retroceso balcony=balcón
balloon=globo charge=carga saver=ahorro beach=playa bed=cama bench=banco bezier=bézier binder=carpeta_de_anillas disabled=deshabilitado searching=buscando blur=desenfoque coins=monedas
contacts=contactos information=información theta=theta none=ninguno bow=lazo tie=corbata chopsticks=palillos salad=ensalada variable=variable circuit=circuito draft=borrador medical=médico
broad=amplio bubble=burbuja factory=fábrica lighthouse=faro mosque=mezquita shop=tienda skyscraper=rascacielos townhouse=casa_adosada yurt=yurta assistant=asistente cancel=cancelar date=fecha
pattern=patrón reply=responder today=hoy numbers=números connecting=conectando inbound=entrante missed=perdida outbound=saliente park=parque transfer=transferir dome=cúpula cart=carrito
cd=cd bubbles=burbujas help=ayuda minus=menos indeterminate=indeterminado unchecked=sin_marcar chess=ajedrez city=ciudad class=clase classification=clasificación paste=pegar alarm=alarma
bill=factura clothes=ropa hanger=percha words=palabras clover=trébol comma=coma northwest=noroeste true=verdadero north=norte compose=redactar conference=conferencia connector=conector
control=control convert=convertir cookies=galletas couch=sofá counter=contador cowork=coworking quick=rápido euro=euro rupee=rupia click=clic dark=oscuro theme=tema dashboard=panel_de_control
area=área funnel=embudo histogram=histograma pie=circular scatter=dispersión sunburst=proyección_solar treemap=mapa_de_árbol waterfall=cascada whisker=bigotes dentist=dentista design=diseño
ideas=ideas signal=señal tower=torre diagram=diagrama directions=indicaciones dishwasher=lavavajillas diversity=diversidad doctor=médico endnote=nota_al_final margins=márgenes columns=columnas
break=salto pdf=pdf extract=extraer drafts=borradores drag=arrastrar beer=cerveza coffee=café wine=vino train=tren drop=gota mirror=espejo dumbbell=pesa dust=polvo elevator=ascensor angry=enfadado
laugh=risa meh=indiferente smile=sonrisa surprise=sorpresa engine=motor medium=medio segment=segmento extended=extendido fax=fax fire=fuego fireplace=chimenea fixed=fijo checkered=a_cuadros
inclusive=inclusivo fluid=fluido holder=soporte zip=zip apple=manzana cake=pastel carrot=zanahoria chicken=pollo leg=pierna egg=huevo grains=cereales pizza=pizza toast=tostada collection=colección
gantt=gantt pump=bomba gather=reunir gesture=gesto gif=gif stand=soporte circles=círculos kanban=kanban return=volver guitar=guitarra handshake=apretón_de_manos strong=fuerte weak=débil
highway=autopista garage=garaje icons=iconos reflection=reflejo immersive=inmersivo reader=lector important=importante incognito=incógnito joystick=joystick command=comando float=flotante
kiosk=quiosco laser=láser lasso=lazo launcher=lanzador dynamic=dinámico learning=aprendizaje library=biblioteca solid=sólido sketch=boceto thickness=grosor ripple=onda lottery=lotería
luggage=equipaje mailbox=buzón match=coincidir linear=lineal professional=profesional medal=medalla meet=reunirse now=ahora loud=alto_volumen memory=memoria brackets=corchetes
microscope=microscopio microwave=microondas optimized=optimizado molecule=molécula trail=sendero movies=películas music=música my=mi adapter=adaptador news=noticias omega=omega oval=óvalo
oven=horno pair=emparejar separate=separar patch=parche patient=paciente wireless=inalámbrico pentagon=pentágono audience=audiencia feedback=comentarios head=cabeza passkey=clave_de_acceso
running=correr spatial=espacial standing=de_pie support=soporte voice=voz walking=caminar setup=configuración shake=agitar photo=foto pi=pi pivot=dinamizar planet=planeta grass=hierba
playing=jugando cards=tarjetas disconnected=desconectado micro=micro backward=hacia_atrás power=encendido predictions=predicciones away=ausente blocked=bloqueado busy=ocupado offline=sin_conexión
unknown=desconocido preview=vista_previa smoking=fumar prompt=indicador ratio=proporción rating=valoración aloud=en_voz_alta mode=modo real=real estate=inmueble refrigerator=frigorífico
remix=remezcla reorder=reordenar replay=repetir large=grande reward=recompensa rhombus=rombo rocket=cohete child=niño ruler=regla run=ejecutar sanitize=desinfectar savings=ahorros scales=balanza
scratchpad=bloc script=guion visual=visual stadium=estadio service=servicio bell=campana cog=engranaje intersect=intersecar organic=orgánico union=unión shapes=formas close=cerrar keyhole=ojo_de_cerradura
minutes=minutos availability=disponibilidad shirt=camisa sim=sim sine=seno skip=omitir slash=barra_oblicua sleep=suspender hide=ocultar topic=tema transition=transición source=origen
spacebar=barra_espaciadora action=acción spatula=espátula spoon=cuchara mute=silenciar spinner=indicador_de_carga american=americano football=fútbol_americano baseball=béisbol basketball=baloncesto
ball=pelota bat=bate hockey=hockey soccer=fútbol spray=aerosol can=lata joint=unión squares=cuadrados nested=anidado emphasis=énfasis steps=pasos stethoscope=estetoscopio storage=almacenamiento
stove=cocina sub=sub subtitles=subtítulos parentheses=paréntesis earbuds=auriculares_internos hub=concentrador swimming=natación pool=piscina syringe=jeringuilla system=sistema private=privado
checker=comprobador less=menor than=que or=o picnic=picnic include=incluir tabs=pestañas tasks=tareas teaching=enseñanza teardrop=lágrima teddy=osito celsius=celsius fahrenheit=fahrenheit
tent=tienda_de_campaña after=después before=antes baseline=línea_base bold=negrita change=cambiar collapse=contraer semi=semi continuous=continuo density=densidad field=campo first=primero
footnote=nota_al_pie hanging=colgante italic=cursiva spacing=espaciado period=punto_final behind=detrás through=a_través tight=ajustado opening=apertura strikethrough=tachado subscript=subíndice
superscript=superíndice whole=entero count=recuento thinking=pensando picker=selector timeline=cronología toilet=inodoro speed=velocidad transmission=transmisión transparency=transparencia
remove=quitar deciduous=caducifolio evergreen=perenne umbrella=paraguas uninstall=desinstalar stick=palo vault=caja_fuerte bicycle=bicicleta bus=autobús cab=taxi cable=cable collision=colisión
parking=aparcamiento motorcycle=motocicleta ship=barco tractor=tractor optimize=optimizar recording=grabación security=seguridad vip=vip vote=votar walkie=walkie talkie=talkie wallpaper=fondo_de_pantalla
washer=lavadora water=agua blowing=soplando drizzle=llovizna duststorm=tormenta_de_polvo fog=niebla haze=bruma humidity=humedad snowflake=copo_de_nieve squalls=chubascos_fuertes thunderstorm=tormenta
web=web asset=activo wheelchair=silla_de_ruedas screwdriver=destornillador xray=rayos_x
`;
export const MORE = Object.fromEntries(RAW.split(/\s+/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1).replace(/_/g, ' ')]; }));
// Extra words that make an icon belong to a category (by category id).
export const EXTRA_WORDS = {
  personas: 'contacts doctor patient dentist laugh angry smile surprise meh handshake',
  comida: 'beer coffee wine pizza cake egg chicken carrot toast salad football baseball basketball soccer hockey guitar movies music chess lottery',
  naturaleza: 'fog haze humidity drizzle thunderstorm snowflake water fire beach grass planet cat dog turtle',
  transporte: 'bicycle bus cab train ship tractor motorcycle parking highway garage city park tent',
  salud: 'microscope stethoscope syringe molecule medical',
};
