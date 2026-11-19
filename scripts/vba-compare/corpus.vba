'#### aritmetica
Function T() As String
    T = (7 \ 2) & "|" & (7 Mod 3) & "|" & (2 ^ 10) & "|" & (7 / 2) & "|" & (-7 \ 2) & "|" & (-7 Mod 3) & "|" & (7.6 Mod 2.2)
End Function
'#### redondeo
Function T() As String
    T = Round(2.5) & "|" & Round(3.5) & "|" & Round(2.345, 2) & "|" & Int(-2.5) & "|" & Fix(-2.5) & "|" & CInt(2.5) & "|" & CInt(3.5) & "|" & CLng(-0.5)
End Function
'#### cadenas-basicas
Function T() As String
    T = Left("Hola mundo", 4) & "|" & Right("Hola mundo", 5) & "|" & Mid("Hola mundo", 6, 3) & "|" & Mid("Hola", 3) & "|" & InStr("Hola mundo", "mu") & "|" & InStrRev("a.b.c", ".") & "|" & Len("abc")
End Function
'#### cadenas-recorte
Function T() As String
    T = "[" & Trim("  x  ") & "][" & LTrim("  x  ") & "][" & RTrim("  x  ") & "]" & UCase("abc") & LCase("ABC")
End Function
'#### cadenas-reemplazo
Function T() As String
    T = Replace("a-b-c", "-", "+") & "|" & StrReverse("abc") & "|" & String(3, "x") & "|" & Len(Space(4)) & "|" & Replace("aaaa", "a", "b", 2, 2) & "|" & Replace("AbA", "a", "x", , , vbTextCompare)
End Function
'#### caracteres
Function T() As String
    T = Chr(65) & "|" & Asc("a") & "|" & Hex(255) & "|" & Oct(8) & "|" & (Chr(9) = vbTab) & "|" & Hex(-1) & "|" & Asc("é")
End Function
'#### formato-numeros
Function T() As String
    T = Format(1234.5, "#,##0.00") & "|" & Format(0.256, "0.0%") & "|" & Format(5, "000") & "|" & Format(-5, "0.0;(0.0)") & "|" & Format(1 / 3, "0.000") & "|" & Format(1234.5, "Fixed") & "|" & Format(0.5, "#.##")
End Function
'#### formato-fechas
Function T() As String
    T = Format(DateSerial(2024, 3, 5), "yyyy-mm-dd") & "|" & Format(TimeSerial(14, 5, 9), "hh:nn:ss") & "|" & Format(TimeSerial(14, 5, 9), "h:nn AM/PM") & "|" & Format(DateSerial(2024, 3, 5), "ddd") & "|" & Format(DateSerial(2024, 3, 5), "mmmm")
End Function
'#### fechas
Function T() As String
    T = Format(DateAdd("m", 1, DateSerial(2024, 1, 31)), "yyyy-mm-dd") & "|" & DateDiff("d", DateSerial(2024, 1, 1), DateSerial(2024, 3, 1)) & "|" & Weekday(DateSerial(2024, 3, 5)) & "|" & Year(DateSerial(2024, 3, 5)) & Month(DateSerial(2024, 3, 5)) & Day(DateSerial(2024, 3, 5)) & "|" & Format(DateSerial(2024, 2, 29) + 1, "yyyy-mm-dd") & "|" & DatePart("q", DateSerial(2024, 8, 1)) & "|" & Format(DateSerial(2024, 13, 1), "yyyy-mm-dd")
End Function
'#### select-case
Function T() As String
    Dim n, r, i
    For Each n In Array(5, 15, 25)
        Select Case n
            Case Is < 10
                r = r & "low,"
            Case 10 To 20
                r = r & "mid,"
            Case Else
                r = r & "high,"
        End Select
    Next
    T = r
End Function
'#### bucles
Function T() As String
    Dim i, s, n
    For i = 10 To 1 Step -3
        s = s & i & ","
    Next i
    n = 0
    Do While n < 3
        n = n + 1
    Loop
    Do
        n = n + 10
    Loop Until n > 20
    For i = 1 To 10
        If i = 4 Then Exit For
    Next
    T = s & n & "|" & i
End Function
'#### matrices
Function T() As String
    Dim a(2) As Integer, b, c() As String, i
    a(0) = 1: a(1) = 2: a(2) = 3
    b = Split("a,b,c,d", ",")
    ReDim c(1)
    c(0) = "x": c(1) = "y"
    ReDim Preserve c(3)
    c(3) = "z"
    T = UBound(a) & "|" & UBound(b) & "|" & Join(b, "-") & "|" & UBound(c) & "|" & Join(c, "") & "|" & LBound(Array(1, 2)) & "|" & UBound(Split("a,b,c", ",", 2))
End Function
'#### matrices-2d
Function T() As String
    Dim m(1, 2), i, j, s
    For i = 0 To 1
        For j = 0 To 2
            m(i, j) = i * 10 + j
        Next
    Next
    T = m(1, 2) & "|" & UBound(m, 1) & "|" & UBound(m, 2)
End Function
'#### error-resume
Function T() As String
    Dim x
    On Error Resume Next
    x = 1 / 0
    T = Err.Number & "|" & (Err.Description <> "")
    Err.Clear
    T = T & "|" & Err.Number
End Function
'#### error-goto
Function T() As String
    On Error GoTo fallo
    Dim a(1)
    a(5) = 1
    T = "sin error"
    Exit Function
fallo:
    T = "error " & Err.Number
End Function
'#### error-desbordamiento
Function T() As String
    Dim i As Integer
    On Error Resume Next
    i = CInt(40000)
    T = Err.Number & "|"
    Err.Clear
    i = 32767
    i = i + 1
    T = T & Err.Number
End Function
'#### error-raise
Function T() As String
    On Error Resume Next
    Err.Raise 1234, "Origen", "Mi error"
    T = Err.Number & "|" & Err.Source & "|" & Err.Description
End Function
'#### coercion
Function T() As String
    T = ("3" + 4) & "|" & ("3" & 4) & "|" & (True + 1) & "|" & CBool(0) & "|" & CBool("1") & "|" & (1 = 1.0) & "|" & ("10" < "9") & "|" & (10 < 9) & "|" & ("10" + "5")
End Function
'#### comparacion
Function T() As String
    T = ("a" < "B") & "|" & ("abc" Like "a*") & "|" & ("abc" = "ABC") & "|" & StrComp("a", "A") & "|" & StrComp("a", "A", vbTextCompare) & "|" & ("b3" Like "[a-c]#") & "|" & ("abc" Like "a?c") & "|" & ("abc" Like "a[!b]c")
End Function
'#### tipos
Function T() As String
    Dim v
    T = TypeName(1) & "|" & TypeName(1.5) & "|" & TypeName("a") & "|" & TypeName(v) & "|" & TypeName(Null) & "|" & TypeName(True) & "|" & TypeName(Array(1)) & "|" & TypeName(#1/1/2000#) & "|" & TypeName(100000) & "|" & VarType(1) & "|" & VarType("a")
End Function
'#### es-funciones
Function T() As String
    Dim v
    T = IsNumeric("12") & "|" & IsNumeric("1e3") & "|" & IsNumeric("abc") & "|" & IsEmpty(v) & "|" & IsDate("2024-03-05") & "|" & IsNull(Null) & "|" & IsArray(Array(1)) & "|" & IsNumeric("") & "|" & IsNumeric("&H1F")
End Function
'#### val
Function T() As String
    T = Val("12abc") & "|" & Val(" 3.5e2") & "|" & Val("&HFF") & "|" & Val("abc") & "|" & Val("1 2 3") & "|" & Val("-.5")
End Function
'#### conversion-texto
Function T() As String
    T = CStr(1 / 3) & "|" & CStr(1E+20) & "|" & CStr(0.1 + 0.2) & "|" & CStr(100000000000000#) & "|" & CStr(1.5) & "|" & CStr(-0.00001) & "|" & CStr(123456789012#) & "|" & CStr(True) & "|" & CDbl("1.5") & "|" & CSng(0.1)
End Function
'#### decimales-locale
Function T() As String
    T = 1.5 & "x" & "|" & Str(1.5) & "|" & Str(-5) & "|" & Str(5) & "|" & CStr(2 / 3) & "|" & (0.1 * 3)
End Function
'#### mid-instruccion
Function T() As String
    Dim s
    s = "Hola mundo"
    Mid(s, 1, 1) = "J"
    Mid(s, 6) = "MUNDO"
    T = s
End Function
'#### variant-vacio
Function T() As String
    Dim v
    T = IsEmpty(v) & "|" & (v + 1) & "|[" & v & "]|" & (v = 0) & "|" & (v = "")
End Function
'#### recursion
Function Fact(n)
    If n <= 1 Then
        Fact = 1
    Else
        Fact = n * Fact(n - 1)
    End If
End Function
Function T() As String
    T = Fact(5) & "|" & Fact(10) & "|" & Fact(20)
End Function
'#### byref-byval
Sub Cambia(ByRef a, ByVal b)
    a = a + 1
    b = b + 1
End Sub
Function T() As String
    Dim x, y
    x = 1: y = 1
    Cambia x, y
    T = x & "|" & y
End Function
'#### static
Function Cuenta()
    Static n As Integer
    n = n + 1
    Cuenta = n
End Function
Function T() As String
    Cuenta
    Cuenta
    T = Cuenta()
End Function
'#### opcionales
Function Suma(a, Optional b = 10, Optional c)
    If IsMissing(c) Then c = 100
    Suma = a + b + c
End Function
Function Todos(ParamArray v())
    Dim i, s
    For i = LBound(v) To UBound(v)
        s = s + v(i)
    Next
    Todos = s
End Function
Function T() As String
    T = Suma(1) & "|" & Suma(1, 2) & "|" & Suma(1, 2, 3) & "|" & Suma(1, c:=5) & "|" & Todos(1, 2, 3, 4)
End Function
'#### coleccion
Function T() As String
    Dim c As New Collection, i, s
    c.Add "uno"
    c.Add "dos", "k2"
    c.Add "tres"
    s = c.Count & "|" & c("k2") & "|" & c(3)
    c.Remove 1
    s = s & "|" & c.Count & "|" & c(1)
    For Each i In c
        s = s & "," & i
    Next
    T = s
End Function
'#### iif-choose
Function T() As String
    T = IIf(3 > 2, "si", "no") & "|" & Choose(2, "a", "b", "c") & "|" & Switch(1 = 2, "x", 2 = 2, "y")
End Function
'#### matematicas
Function T() As String
    T = Sqr(16) & "|" & Abs(-3) & "|" & Sgn(-2) & "|" & Round(Exp(1), 4) & "|" & Round(Log(100) / Log(10), 4) & "|" & Round(Atn(1) * 4, 6) & "|" & Sin(0) & "|" & Round(Cos(0), 1) & "|" & Int(7.9) & "|" & 10 ^ -2
End Function
'#### bits
Function T() As String
    T = (5 And 3) & "|" & (5 Or 3) & "|" & (5 Xor 3) & "|" & (Not 5) & "|" & (True And False) & "|" & (True Or False) & "|" & (12 And 10) & "|" & (Not True)
End Function
'#### instr-opciones
Function T() As String
    T = InStr(1, "ABC", "b", vbTextCompare) & "|" & InStr("ABC", "b") & "|" & InStr(3, "abcabc", "b") & "|" & InStr("abc", "") & "|" & InStr("", "a")
End Function
'#### filtro-union
Function T() As String
    Dim a
    a = Filter(Array("manzana", "pera", "piña", "uva"), "p")
    T = UBound(a) + 1 & "|" & Join(a, ",") & "|" & Join(Array(1, 2, 3), "/") & "|" & UBound(Split("", ","))
End Function
'#### mid-fuera-rango
Function T() As String
    On Error Resume Next
    T = Mid("abc", 0, 1)
    T = T & "|" & Err.Number
    Err.Clear
    T = T & "|" & Left("abc", 10) & "|" & Mid("abc", 5) & "|" & Err.Number
End Function
'#### salida-funcion
Function Busca(v)
    Dim x
    For Each x In Array(1, 2, 3)
        If x = v Then
            Busca = "hallado " & x
            Exit Function
        End If
    Next
    Busca = "no"
End Function
Function T() As String
    T = Busca(2) & "|" & Busca(9)
End Function
'#### with-bloque
Function T() As String
    Dim c As New Collection
    With c
        .Add 1
        .Add 2
        T = .Count
    End With
End Function
'#### cadenas-formato-especiales
Function T() As String
    T = UCase$("abc") & "|" & Left$("abc", 2) & "|" & Space$(2) & "|" & Chr$(66) & "|" & LCase$("ÁB") & "|" & Len("ñandú") & "|" & StrConv("hola mundo", vbProperCase)
End Function
'#### numeros-grandes
Function T() As String
    Dim l As Long, d As Double
    l = 2147483647
    d = l + 1
    T = d & "|" & (2147483647 + 1) & "|" & (10 ^ 15) & "|" & (10 ^ 16) & "|" & 1E+15 & "|" & 123456789 * 1000 & "|" & (3 * 0.1) & "|" & 1000000 * 1000000
End Function
'#### division-entera-errores
Function T() As String
    On Error Resume Next
    Dim x
    x = 5 \ 0
    T = Err.Number
    Err.Clear
    x = 5 Mod 0
    T = T & "|" & Err.Number
    Err.Clear
    x = Sqr(-1)
    T = T & "|" & Err.Number
    Err.Clear
    x = Log(0)
    T = T & "|" & Err.Number
End Function
