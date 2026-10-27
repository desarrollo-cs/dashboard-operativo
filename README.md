# Dashboard operativo — SAC, Cobros, Crédito y Ventas

Dashboard web estático para el reporte de llamadas de inConcert «ReportDetailInOutCallsByCampaign» de Coocique. No usa backend ni credenciales. Las páginas son General, Operativa SAC, Operativa Ventas y Operativa Cobros. Crédito se integra en General, en los filtros y en la vista SAC.

Se publica en GitHub Pages y se actualiza a diario de una de dos formas:

- cargando el Excel directamente en el navegador, sin enviar datos a ningún servicio;
- reemplazando el dataset integrado anonimizado.

## Estructura

```
├── index.html                  Página única con las 4 pestañas
├── css/styles.css              Sistema visual (φ y Fibonacci, marca Customer Touch)
├── js/
│   ├── config.js               Umbrales, colores, columnas y agrupación de tipificaciones
│   ├── parser.js               Excel → registros normalizados (navegador y Node)
│   ├── metrics.js              Clasificación, filtros, indicadores y controles de calidad
│   ├── charts.js               Gráficos ECharts
│   └── app.js                  Interfaz, filtros, pestañas y metodología
├── vendor/                     ECharts 5.5.1 y SheetJS 0.18.5 (locales, con licencias)
├── assets/                     Logo e isotipo vectoriales extraídos del manual de marca
├── data/dataset.json           Dataset integrado ANONIMIZADO (sin nombres ni teléfonos)
├── scripts/
│   ├── build-dataset.mjs       Regenera data/dataset.json desde un Excel
│   └── qa-check.mjs            Controles de calidad (sale con error si alguno falla)
├── .github/workflows/qa.yml    Ejecuta los controles en cada push
├── .gitignore                  Impide subir archivos .xlsx con datos personales
└── .nojekyll
```

## Ejecutar localmente

El navegador bloquea la lectura de `data/dataset.json` cuando se abre `index.html` con doble clic (`file://`). En ese modo el dashboard muestra un aviso y permite cargar el Excel con el botón.

Para ver el dataset integrado, sirve la carpeta:

```bash
cd dashboard-operativo
python3 -m http.server 8000     # o: npx serve .
# abrir http://localhost:8000
```

Node.js 18 o superior solo es necesario para los scripts; el dashboard no lo requiere.

## Subir a GitHub y publicar con GitHub Pages

1. Crea un repositorio en GitHub. Se recomienda que sea **privado** (ver *Privacidad*).
2. Desde la carpeta del proyecto, ejecuta:

   ```bash
   git init
   git add .
   git commit -m "Dashboard operativo inicial"
   git branch -M main
   git remote add origin https://github.com/<organizacion>/<repositorio>.git
   git push -u origin main
   ```

3. En GitHub, abre **Settings → Pages → Build and deployment**.
   - En **Source** elige «Deploy from a branch».
   - Selecciona la rama `main` y la carpeta `/ (root)`, y guarda.
4. Espera unos minutos. El sitio queda en `https://<organizacion>.github.io/<repositorio>/`.

Todas las rutas son relativas, así que el sitio funciona en una subcarpeta de Pages.

Las Pages de un repositorio privado son públicas en los planes Free, Pro y Team. Para restringir el acceso por usuario se necesita GitHub Enterprise Cloud con *Pages access control*.

## Actualización diaria

Elige una de estas opciones.

**A. Consulta inmediata, sin publicar.** Abre el sitio y pulsa «Cargar Excel de inConcert». El archivo se procesa en el navegador y todos los indicadores se recalculan. Nada se guarda ni se envía, y el sitio publicado no cambia.

**B. Actualizar el dataset publicado, sin instalar nada.**
1. Carga el Excel con el botón y pulsa «Exportar dataset anonimizado».
2. Se descarga `dataset.json`. Los teléfonos quedan reemplazados por un hash SHA-256 con sal aleatoria descartada, y los nombres de contacto no se exportan.
3. Reemplaza `data/dataset.json` en el repositorio. Puedes hacerlo en GitHub con «Add file → Upload files», o con:

   ```bash
   git add data/dataset.json
   git commit -m "Datos al <fecha>"
   git push
   ```

4. Pages se republica solo, normalmente en 1 a 2 minutos.

**C. Por línea de comandos (Node).**

```bash
node scripts/qa-check.mjs "Input_Gestion_Coocique.xlsx"      # valida antes de publicar
node scripts/build-dataset.mjs "Input_Gestion_Coocique.xlsx"  # escribe data/dataset.json
git add data/dataset.json && git commit -m "Datos al <fecha>" && git push
```

En todas las opciones, el archivo nuevo debe conservar dos cosas:

- la hoja de detalle con los encabezados de inConcert;
- la tabla «Campaña → Departamento». Puede estar en cualquier hoja; se detecta por el encabezado «Campaña» seguido de «Departamento».

Las campañas nuevas que no figuren en esa tabla se muestran como «Sin clasificar» y generan un aviso. Para clasificarlas, agrégalas a la tabla del Excel.

### Automatización sin intervención manual

GitHub versiona y aloja el sitio, pero **no obtiene el Excel por sí mismo**. Un flujo diario automático requiere tres componentes adicionales:

1. **Origen automático del archivo.** Puede ser una exportación programada de inConcert a SFTP o almacenamiento en la nube, o la API de reportes de inConcert si el contrato la incluye.
2. **Un job programado.** Por ejemplo, GitHub Actions con `schedule`, o un servidor interno con cron. El job descarga el archivo usando credenciales guardadas como *secrets* y ejecuta `node scripts/qa-check.mjs` y luego `node scripts/build-dataset.mjs`.
3. **Publicación del resultado.** El job hace commit de `data/dataset.json` solo si los controles pasan.

El Excel crudo nunca debe guardarse en el repositorio.

## Privacidad

El Excel original contiene nombres y teléfonos de clientes. Este proyecto los protege así:

- `data/dataset.json` no incluye nombres de contacto, y los teléfonos son hashes no reversibles. Solo sirven para contar números únicos.
- `.gitignore` excluye `*.xlsx`, `*.xls` y `*.xlsm`.
- Sí se incluyen los usuarios de agentes de inConcert, porque los gráficos por agente los necesitan.

Si el sitio no debe ser visible fuera de la organización, usa Pages con control de acceso o un hosting interno.

## Reglas de datos aplicadas

| Concepto | Definición (campos reales) |
|---|---|
| Departamento | Tabla «Campaña → Departamento» del Excel. Las campañas «No tomar en cuenta» se excluyen por completo. Cada registro tiene un único departamento. |
| Entrante ofrecida | `Inic.` = Ent. y `Buscó agente` = Si |
| Atendida / abandonada | Ofrecida con `Aten.` = Si / con `Ab.` = Si |
| Abandono del sistema / del cliente | Abandonada con `Finalizador` = «ACD timeout» / = «Contacto». Los demás finalizadores se informan como «sin determinar». |
| Nivel de servicio | Atendidas con `Tiempo Esp.` ≤ 20 s / ofrecidas |
| Intento saliente | `Inic.` = Sal. El modo sale de `Tipo de Llamada saliente`. |
| Conectada (con agente) | `Aten.` = Si |
| Contestada | `Aten.` = Si o `Ab.` = Si |
| Abandono del marcador | `Ab.` = Si en modo Marcación. Fórmula: abandonos / (conectadas en marcador + abandonos) |
| No conectada | `Canc.` = Si. Los tres estados salientes son excluyentes; esto se verifica en los controles. |
| Gestión tipificada | `Disp. Abs.` (o `Disp.`) distinto de N/A o vacío |
| Números únicos | `Dir.` normalizado a dígitos. A los números de 11 dígitos con prefijo 506 se les quita el prefijo. |
| Espera | `Tiempo Esp.` (s) de las atendidas: promedio y P90 por interpolación lineal |
| Conversación | Entrante: `Tiempo atención`. Saliente: `Tiempo Conc.` En minutos: promedio y mediana. |
| Duraciones > 2 h | Fuera de promedios, medianas y percentiles; dentro de los conteos |
| Conversación de 0 s | Se trata como no medida y no entra en promedios |
| Día parcial (*) | Primer o último día cuyo primer/último registro difiere al menos 60 min de los días del mismo tipo (lunes a viernes, sábado o domingo) |
| Mapa de calor | «—» cuando la celda tiene menos de 5 ofrecidas |

Sobre la conversación de 0 s: en `coocique_central`, las 43 salientes conectadas traen `Tiempo Conc.` = 0 aunque `Tiempo atención` tiene valores. Ese campo no se sustituye, porque la regla indica `Tiempo Conc.`.

**Agrupación de tipificaciones de Ventas** (`js/config.js` → `salesGroups`):

| Grupo | Tipificaciones incluidas |
|---|---|
| Seguimiento | Todo lo que está bajo `/Seguimiento/` |
| Sin contacto efectivo | `/Baja/Sin contacto efectivo` |
| Baja por riesgo | SUGEF, referencias negativas en Buró, juicios en Buró, riesgo CIC, salario inferior a 475000, sin capacidad de pago |
| Baja por desinterés | No le interesa realizar crédito, no le interesaron las condiciones, no le son atractivas las condiciones |
| Otras tipificaciones (sin agrupar) | Todo lo demás. No se asigna por similitud. |

**Cobros** no muestra tipificaciones, resultados de contacto ni compromisos.

## Clasificación del archivo actual (01/10/2026 – 22/10/2026*, corte 10:09)

| | Entrantes | Salientes | Total |
|---|---:|---:|---:|
| SAC | 1.416 | 1 | 1.417 |
| Ventas | 331 | 253 | 584 |
| Cobros | 456 | 5.678 | 6.134 |
| Crédito | 0 | 0 | 0 |
| Excluidas (`test` 9, `transferencias_cobros_creditos` 5) | | | 14 |
| **Total del archivo** | | | **8.149** |

- **Crédito:** la tabla del Excel no asigna ninguna campaña a Crédito; las campañas `coocique_credito_*` están mapeadas a Ventas. Crédito aparece en filtros y en General con 0 registros, y el selector Crédito de la pestaña SAC queda desactivado. Se activa solo si un archivo futuro asigna campañas a Crédito. Esa ruta fue probada con un archivo sintético.
- **Ventas:** la pestaña cubre solo salientes. Las 331 entrantes de campañas de Ventas aparecen en General.
- **Salientes de SAC:** el único registro saliente aparece solo en General.

## Sistema visual: qué es exacto y qué es aproximado

**Medido en el navegador**

| Elemento | Valor |
|---|---|
| Espaciado | Escala Fibonacci exacta: 8, 13, 21, 34, 55 y 89 px. Huecos y padding de 21 px en escritorio y tablet, 13 px en móvil. |
| Tarjetas KPI principales (escritorio) | 283 px frente a 175 px de las secundarias: razón 1,618. Valores a 34 px frente a 21 px (razón 1,619). |
| Área de los gráficos | Relación ancho/alto de 1,62 (rectángulo áureo). El gráfico a ancho completo de Cobros usa 3φ = 4,85, lo que da una altura aproximadamente igual a la de las demás, porque no descuenta los huecos. |
| Logo | 34 px de alto: el círculo naranja (X) mide unos 9,6 px y el espacio libre aplicado es de 13 px en los cuatro lados. En móvil el logo mide 21 px (X ≈ 5,9 px) con 13 px de margen. |
| Encabezado y metodología | Columnas en proporción 1,618 : 1 |
| Ancho máximo | 1.597 px, término de Fibonacci |

**Aproximaciones y adaptaciones**

- **Tipografía:** 13, 21 y 34 px son términos de Fibonacci con razones de ≈ φ. Los 16 px son el semipaso 13 × √φ ≈ 16,5, redondeado.
- **Tablet (768–1279 px):** las seis tarjetas KPI tienen el mismo ancho. La jerarquía se mantiene con el tamaño del valor y el borde superior azul, no con el ancho. Los gráficos van en 2 columnas.
- **Móvil (< 768 px):** las dos KPI principales ocupan el ancho completo (≈ 2,07× el de una secundaria) y los gráficos usan una relación √φ ≈ 1,27 para ganar altura legible.

**Colores**

| Color | Uso |
|---|---|
| Azul `#27357D` | Títulos, valores, embudos y líneas porcentuales |
| Celeste `#52C3F1` | Atendidas y conectadas |
| Naranja `#F8AF45` | Abandonos y puntos de alerta. Nunca se usa para texto. |
| Verde `#57E68C` | Solo líneas de % conexión y de conversación por agente. Es `#45F887` con la saturación HSL al 80 % (S 92,7 % → 74,2 %). |
| Paleta secundaria | Muestreada del manual, para las series de apoyo |
| Mapa de calor | Escala de blanco a naranja |

## Controles de calidad ejecutados

**`node scripts/qa-check.mjs` (28 controles, todos superados con el archivo actual)**

- Pruebas unitarias de:
  - parseo de duraciones, fechas y teléfonos;
  - percentil;
  - umbral de 5 llamadas del mapa de calor;
  - exclusión de duraciones > 2 h;
  - tipos de abandono.
- Reconciliación con el total del archivo.
- Un solo departamento por registro, sin duplicados, fechas válidas y estados excluyentes.
- Consistencia entre pestañas.
- Embudos con etapas anidadas.

Con una campaña sin mapear, el script falla como corresponde.

**Pruebas en navegador (Chromium sin interfaz, Playwright; 42 de 42 superadas)**

| Área | Qué se verificó |
|---|---|
| Carga de datos | Dataset integrado; carga del Excel real con KPI idénticos al dataset; apertura con `file://` más carga manual |
| Filtros | Rango de fechas, contrastado con un cálculo independiente en pandas; campaña; departamento, incluida la pestaña vacía; mes y rango de meses; restablecer |
| Exportación | Sin teléfonos ni nombres en claro |
| Crédito | Vista con datos sintéticos, sexta tarjeta y línea de referencia SAC |
| Errores de formato | Campaña sin mapear; Excel sin hoja de detalle; archivo que no es Excel |
| Interfaz | Leyendas y tooltips; navegación por teclado y enlaces `#pestaña`; ausencia de errores de JavaScript |

**Revisión visual** en 1440, 1024 y 390 px: cero solapes entre tarjetas y sin desplazamiento horizontal.

No se probaron:

- el despliegue real en GitHub Pages;
- Safari, Firefox y dispositivos físicos;
- archivos de inConcert con columnas o formatos de fecha distintos al recibido.

## Limitaciones conocidas

- **SheetJS 0.18.5** es la última versión publicada en npm y tiene una vulnerabilidad conocida al leer archivos manipulados (CVE-2023-30533). El riesgo es bajo porque solo se cargan exportaciones propias de inConcert. Aun así, se recomienda reemplazar `vendor/xlsx.full.min.js` por la versión vigente de https://cdn.sheetjs.com, con el mismo nombre de archivo y sin otros cambios.
- **Ventas:** la conversación promedio se calcula solo con las 73 conectadas que tienen `Tiempo Conc.` > 0 (ver «Conversación de 0 s» arriba).
- **Agentes:** las salientes usan «Primer agente» y las entrantes atendidas, «Último agente».
- **Tamaño del dataset:** el JSON pesa unos 1,5 MB para 8.149 registros. Para meses completos (≈ 12× más) sigue siendo manejable, pero conviene publicar periodos acotados.

## Personalización

Todo umbral, color, columna o regla de agrupación está en `js/config.js`. Cambiarlo actualiza indicadores, gráficos y metodología sin tocar el resto del código.
