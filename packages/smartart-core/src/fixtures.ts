// Archivos de ejemplo para las pruebas, con la forma de los que escribe Office (escritos a mano: no son copias de ningún archivo).
const NS = 'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

export const DATA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:dataModel ${NS}>
<dgm:ptLst>
<dgm:pt modelId="{D0}" type="doc"><dgm:prSet loTypeId="urn:test/layout/default" loCatId="list" qsTypeId="urn:test/quickStyle/simple1" qsCatId="simple" csTypeId="urn:test/colors/accent1_2" csCatId="accent1" phldr="0"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{N1}"><dgm:prSet phldrT="[Texto]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" b="1"/><a:t>Uno </a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{N2}"><dgm:prSet phldrT="[Texto]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES"/><a:t>Dos &amp; medio</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{N3}"><dgm:prSet phldrT="[Texto]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES"/><a:t>Hijo de dos</a:t></a:r></a:p><a:p><a:r><a:rPr lang="es-ES"/><a:t>segunda línea</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{N4}" type="asst"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES"/><a:t>Ayudante</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{PT1}" type="parTrans" cxnId="{C1}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{ST1}" type="sibTrans" cxnId="{C1}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{PT2}" type="parTrans" cxnId="{C2}"><dgm:prSet/><dgm:spPr/></dgm:pt>
<dgm:pt modelId="{ST2}" type="sibTrans" cxnId="{C2}"><dgm:prSet/><dgm:spPr/></dgm:pt>
<dgm:pt modelId="{PT3}" type="parTrans" cxnId="{C3}"><dgm:prSet/><dgm:spPr/></dgm:pt>
<dgm:pt modelId="{ST3}" type="sibTrans" cxnId="{C3}"><dgm:prSet/><dgm:spPr/></dgm:pt>
<dgm:pt modelId="{PT4}" type="parTrans" cxnId="{C4}"><dgm:prSet/><dgm:spPr/></dgm:pt>
<dgm:pt modelId="{ST4}" type="sibTrans" cxnId="{C4}"><dgm:prSet/><dgm:spPr/></dgm:pt>
<dgm:pt modelId="{P0}" type="pres"><dgm:prSet presAssocID="{D0}" presName="diagram" presStyleCnt="0"><dgm:presLayoutVars><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:presLayoutVars></dgm:prSet><dgm:spPr/></dgm:pt>
</dgm:ptLst>
<dgm:cxnLst>
<dgm:cxn modelId="{C1}" srcId="{D0}" destId="{N1}" srcOrd="0" destOrd="0" parTransId="{PT1}" sibTransId="{ST1}"/>
<dgm:cxn modelId="{C2}" srcId="{D0}" destId="{N2}" srcOrd="1" destOrd="0" parTransId="{PT2}" sibTransId="{ST2}"/>
<dgm:cxn modelId="{C3}" srcId="{N2}" destId="{N3}" srcOrd="0" destOrd="0" parTransId="{PT3}" sibTransId="{ST3}"/>
<dgm:cxn modelId="{C4}" srcId="{D0}" destId="{N4}" srcOrd="2" destOrd="0" parTransId="{PT4}" sibTransId="{ST4}"/>
<dgm:cxn modelId="{X1}" type="presOf" srcId="{N1}" destId="{P0}" srcOrd="0" destOrd="0" presId="urn:test/layout/default"/>
<dgm:cxn modelId="{X2}" type="presParOf" srcId="{P0}" destId="{P0}" srcOrd="0" destOrd="0" presId="urn:test/layout/default"/>
</dgm:cxnLst>
<dgm:bg/>
<dgm:whole/>
<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rId6" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst>
</dgm:dataModel>`;

/** La estructura del diseño «Lista de bloques básica» (`default`), escrita a mano. */
export const LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:layoutDef ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" uniqueId="urn:test/layout/default">
<dgm:title val="Lista de bloques"/><dgm:desc val="Para información sin orden"/>
<dgm:catLst><dgm:cat type="list" pri="400"/></dgm:catLst>
<dgm:sampData><dgm:dataModel><dgm:ptLst><dgm:pt modelId="0" type="doc"/><dgm:pt modelId="1"><dgm:prSet phldr="1"/></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="2" srcId="0" destId="1" srcOrd="0" destOrd="0"/></dgm:cxnLst><dgm:bg/><dgm:whole/></dgm:dataModel></dgm:sampData>
<dgm:styleData><dgm:dataModel><dgm:ptLst><dgm:pt modelId="0" type="doc"/></dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/></dgm:dataModel></dgm:styleData>
<dgm:clrData><dgm:dataModel><dgm:ptLst><dgm:pt modelId="0" type="doc"/></dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/></dgm:dataModel></dgm:clrData>
<dgm:layoutNode name="diagram">
<dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>
<dgm:choose name="Name0">
<dgm:if name="Name1" func="var" arg="dir" op="equ" val="norm"><dgm:alg type="snake"><dgm:param type="grDir" val="tL"/><dgm:param type="flowDir" val="row"/><dgm:param type="contDir" val="sameDir"/><dgm:param type="off" val="ctr"/></dgm:alg></dgm:if>
<dgm:else name="Name2"><dgm:alg type="snake"><dgm:param type="grDir" val="tR"/><dgm:param type="flowDir" val="row"/><dgm:param type="contDir" val="sameDir"/><dgm:param type="off" val="ctr"/></dgm:alg></dgm:else>
</dgm:choose>
<dgm:shape r:blip=""><dgm:adjLst/></dgm:shape>
<dgm:presOf/>
<dgm:constrLst>
<dgm:constr type="w" for="ch" forName="node" refType="w"/>
<dgm:constr type="h" for="ch" forName="node" refType="w" refFor="ch" refForName="node" fact="0.6"/>
<dgm:constr type="w" for="ch" forName="sibTrans" refType="w" refFor="ch" refForName="node" fact="0.1"/>
<dgm:constr type="sp" refType="w" refFor="ch" refForName="sibTrans"/>
<dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/>
</dgm:constrLst>
<dgm:ruleLst/>
<dgm:forEach name="Name3" axis="ch" ptType="node">
<dgm:layoutNode name="node"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/><dgm:shape type="rect" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="desOrSelf" ptType="node"/>
<dgm:constrLst><dgm:constr type="lMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="rMarg" refType="primFontSz" fact="0.3"/></dgm:constrLst>
<dgm:ruleLst><dgm:rule type="primFontSz" val="5" fact="NaN" max="NaN"/></dgm:ruleLst></dgm:layoutNode>
<dgm:forEach name="Name4" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="sibTrans"><dgm:alg type="sp"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/></dgm:layoutNode></dgm:forEach>
</dgm:forEach>
</dgm:layoutNode>
</dgm:layoutDef>`;

export const STYLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:styleDef ${NS} uniqueId="urn:test/quickStyle/simple1"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst>
<dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d>
<dgm:styleLbl name="node1"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dgm:style></dgm:styleLbl>
<dgm:styleLbl name="sibTrans2D1"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dgm:style></dgm:styleLbl>
</dgm:styleDef>`;

export const COLORS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:colorsDef ${NS} uniqueId="urn:test/colors/accent1_2"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="accent1" pri="11200"/></dgm:catLst>
<dgm:styleLbl name="node1"><dgm:fillClrLst meth="repeat"><a:schemeClr val="accent1"/></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst/><dgm:txEffectClrLst/></dgm:styleLbl>
<dgm:styleLbl name="sibTrans2D1"><dgm:fillClrLst><a:schemeClr val="accent1"><a:tint val="60000"/></a:schemeClr><a:schemeClr val="accent1"/></dgm:fillClrLst><dgm:linClrLst hueDir="ccw" meth="cycle"><a:schemeClr val="accent1"><a:tint val="60000"/></a:schemeClr></dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst/><dgm:txEffectClrLst/></dgm:styleLbl>
</dgm:colorsDef>`;

export const DRAWING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dsp:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>
<dsp:sp modelId="{P1}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm rot="900000"><a:off x="100" y="200"/><a:ext cx="3000" cy="1800"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></dsp:spPr><dsp:style><a:lnRef idx="2"/><a:fillRef idx="1"/><a:effectRef idx="0"/><a:fontRef idx="minor"/></dsp:style><dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="68580" tIns="68580" rIns="68580" bIns="68580" numCol="1" spcCol="1270" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" sz="2400"/><a:t>Uno </a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="150" y="250"/><a:ext cx="2900" cy="1700"/></dsp:txXfrm></dsp:sp>
<dsp:sp modelId="{P2}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm flipH="1"><a:off x="3500" y="200"/><a:ext cx="3000" cy="1800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></dsp:spPr></dsp:sp>
</dsp:spTree></dsp:drawing>`;

/** Un proceso lineal (nodos con flechas entre ellos), escrito a mano con el lenguaje de diseños. */
export const LAYOUT_PROCESS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:layoutDef ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" uniqueId="urn:suitenova/layout/process">
<dgm:title val="Proceso"/><dgm:desc val="Pasos con flechas"/><dgm:catLst><dgm:cat type="process" pri="100"/></dgm:catLst>
<dgm:layoutNode name="diagram">
<dgm:varLst><dgm:dir/></dgm:varLst>
<dgm:choose name="d"><dgm:if name="n" func="var" arg="dir" op="equ" val="norm"><dgm:alg type="lin"/></dgm:if><dgm:else name="r"><dgm:alg type="lin"><dgm:param type="linDir" val="fromR"/></dgm:alg></dgm:else></dgm:choose>
<dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/>
<dgm:constrLst>
<dgm:constr type="w" for="ch" forName="node" refType="w"/>
<dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/>
<dgm:constr type="w" for="ch" forName="arrow" refType="w" refFor="ch" refForName="node" fact="0.4"/>
</dgm:constrLst>
<dgm:forEach name="each" axis="ch" ptType="node">
<dgm:layoutNode name="node"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>
<dgm:shape type="roundRect" r:blip=""><dgm:adjLst><dgm:adj idx="1" val="0.1"/></dgm:adjLst></dgm:shape><dgm:presOf axis="desOrSelf" ptType="node"/>
<dgm:constrLst><dgm:constr type="h" refType="w" fact="0.6"/><dgm:constr type="lMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="rMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="tMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="bMarg" refType="primFontSz" fact="0.3"/></dgm:constrLst>
<dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode>
<dgm:forEach name="between" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="arrow"><dgm:alg type="conn"/>
<dgm:shape type="conn" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/>
<dgm:constrLst><dgm:constr type="h" refType="w" fact="0.62"/><dgm:constr type="connDist"/></dgm:constrLst></dgm:layoutNode></dgm:forEach>
</dgm:forEach>
</dgm:layoutNode>
</dgm:layoutDef>`;
