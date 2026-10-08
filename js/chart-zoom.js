// html { zoom: .8 } кезінде браузер тінтуір координатасын масштабталған түрде береді,
// ал Chart.js оларды масштабсыз деп санайды — tooltip басқа нүктеде шығады. Координатаны қайта есептейміз.
Chart.register({
  id: 'zoomFix',
  beforeEvent(chart, args) {
    const c = chart.canvas;
    const z = c.clientWidth ? c.getBoundingClientRect().width / c.clientWidth : 1;
    if (Math.abs(z - 1) < 0.01) return;
    const e = args.event;
    if (e.x != null) { e.x /= z; e.y /= z; }
    args.inChartArea = chart.isPointInArea(e);
  },
});
