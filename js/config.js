/* Configuración central del dashboard.
 * Todo umbral, color o regla de agrupación vive aquí para que la actualización
 * diaria no requiera tocar gráficos ni indicadores. */
(function (root) {
  'use strict';

  var CONFIG = {
    // Umbrales de cálculo
    slThresholdSec: 20,          // Nivel de servicio: atendidas con espera <= 20 s
    maxDurationSec: 7200,        // Duraciones > 2 h se excluyen de estadísticas de tiempo (no de conteos)
    heatmapMinCalls: 5,
    partialDayMarginMin: 60,     // Margen mínimo (min) para confirmar un día parcial frente a días comparables          // Celdas del mapa de calor con < 5 ofrecidas muestran «—»
    topAgents: 10,
    findingsMinN: 20,            // Volumen mínimo de una franja, día o agente para sustentar un hallazgo
    findingsRetryMin: 3,         // Intentos mínimos por número para el hallazgo de reintentos sin conexión
    waitBuckets: [
      { label: '0–10 s', max: 10 },
      { label: '11–20 s', max: 20 },
      { label: '21–30 s', max: 30 },
      { label: '31–60 s', max: 60 },
      { label: '61–90 s', max: 90 },
      { label: '>90 s', max: Infinity }
    ],

    // Departamentos canónicos (orden de presentación). «Crédito» se integra en General y en SAC.
    departments: ['SAC', 'Ventas', 'Cobros', 'Crédito'],
    excludeLabel: 'No tomar en cuenta',

    // Columnas obligatorias del reporte inConcert «ReportDetailInOutCallsByCampaign»
    columns: {
      campaign: 'Campaña',
      start: 'Fecha de inicio',
      direction: 'Inic.',
      phone: 'Dir.',
      firstAgent: 'Primer agente',
      lastAgent: 'Último agente',
      queued: 'Buscó agente',
      answered: 'Aten.',
      abandoned: 'Ab.',
      cancelled: 'Canc.',
      finalizer: 'Finalizador',
      wait: 'Tiempo Esp.',
      talkIn: 'Tiempo atención',
      talkOut: 'Tiempo Conc.',
      disp: 'Disp.',
      dispAbs: 'Disp. Abs.',
      transfer: 'Tr.',
      transferOk: 'Tr. Ok',
      convId: 'Id conversación',
      dialMode: 'Tipo de Llamada saliente'
    },

    // Agrupación de tipificaciones de Ventas (solo resultados de conectadas).
    // Regla: se usa la ruta jerárquica «Disp. Abs.». Toda tipificación no listada
    // se muestra como «Otras tipificaciones (sin agrupar)»; nunca se fuerza a un grupo.
    salesGroups: {
      prefixRules: [
        { prefix: '/Seguimiento/', group: 'Seguimiento' }
      ],
      exactRules: {
        '/Baja/Sin contacto efectivo': 'Sin contacto efectivo',
        '/Baja/Afectado por SUGEF': 'Baja por riesgo',
        '/Baja/Afectado según SUGEF': 'Baja por riesgo',
        '/Baja/Cliente con Referencias Negativas en BURO': 'Baja por riesgo',
        '/Baja/Juicios registrados en Buró': 'Baja por riesgo',
        '/Baja/Nivel Alto de Riesgo CIC': 'Baja por riesgo',
        '/Baja/Salario Inferior a 475000': 'Baja por riesgo',
        '/Baja/Sin Capacidad de Pago': 'Baja por riesgo',
        '/Baja/No le interesa realizar crédito': 'Baja por desinterés',
        '/Baja/No le interesaron las condiciones': 'Baja por desinterés',
        '/Baja/No le son atractivas las condiciones': 'Baja por desinterés'
      },
      order: ['Baja por riesgo', 'Baja por desinterés', 'Sin contacto efectivo', 'Seguimiento',
        'Otras tipificaciones (sin agrupar)', 'Sin tipificación']
    },

    // Identidad Customer Touch (manual de marca)
    colors: {
      navy: '#27357D',
      sky: '#52C3F1',
      orange: '#F8AF45',
      white: '#FFFFFF',
      // #45F887 con saturación HSL al 80 % (S 92,7 % → 74,2 %; H 142°, L 62,2 %)
      green: '#57E68C',
      // Paleta secundaria muestreada del manual
      secondary: ['#244092', '#304C9B', '#33519F', '#356D9F', '#2B7CA1', '#55BFCA', '#4FBDC8', '#5EBEB2'],
      neutrals: ['#1D1D1B', '#303031', '#5C5C5C', '#919191', '#BCBCBC', '#8F97BB', '#505E92', '#21264B'],
      notConnected: '#BCBCBC',
      grid: '#E6E8F0'
    },

    weekdays: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
    locale: 'es-CR',
    defaultDatasetPath: 'data/dataset.json'
  };

  root.CTConfig = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
