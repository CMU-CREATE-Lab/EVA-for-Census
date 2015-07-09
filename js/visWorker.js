// the code for vis engine worker
var rawdata, ui_params, data_params, numberOfFrames, map_params, colorPalette, metaData, engineID;

onmessage = function(m) {
  rawdata = new DataView(m.data.rawdata);
  ui_params = m.data.ui_params;
  data_params = m.data.data_params;
  numberOfFrames = m.data.numberOfFrames;
  map_params = m.data.map_params;
  colorPalette = m.data.colorPalette;
  metaData = m.data.metaData;
  engineID = m.data.engineID;

  // find number of particles in each frame
  particles = Array.apply(null, new Array(numberOfFrames)).map(Number.prototype.valueOf, 0);
  min_value = Array.apply(null, new Array(numberOfFrames)).map(Number.prototype.valueOf, Number.MAX_VALUE);
  max_value = Array.apply(null, new Array(numberOfFrames)).map(Number.prototype.valueOf, -Number.MAX_VALUE);

  var frameIndex, timeframeSize;

  if (numberOfFrames == 1) {
    particles[0] = data_params.totalParticles;
  } else {
    timeframeSize = (data_params.maxOfColumn[ui_params.time_map] - data_params.minOfColumn[ui_params.time_map]) / numberOfFrames;
    for (var p = 0; p < data_params.totalParticles; p++) {
      frameIndex = Math.floor((readData(p, ui_params.time_map) - data_params.minOfColumn[ui_params.time_map]) / timeframeSize);
      if (isNaN(frameIndex)) continue;
      if (frameIndex == numberOfFrames) frameIndex--;
      particles[frameIndex]++;
    }
  }

  // assign temporal memory
  var positions = [], colors = [], indices = [];
  for (var f = 0; f < numberOfFrames; f++) {
    positions.push(new Float32Array(particles[f] * 3));
    colors.push(new Float32Array(particles[f] * 3));
    indices.push(-1);
  }

  // find position and color for each data point in each frame
  var dummy;
  for (var p = 0; p < data_params.totalParticles; p++) {

    frameIndex = 0;
    if (numberOfFrames > 1) {
      dummy = readData(p, ui_params.time_map);
      frameIndex = Math.floor((dummy - data_params.minOfColumn[ui_params.time_map]) / timeframeSize);
      if (isNaN(frameIndex)) continue;
      if (frameIndex == numberOfFrames) frameIndex--;
      min_value[frameIndex] = Math.min(min_value[frameIndex], dummy);
      max_value[frameIndex] = Math.max(max_value[frameIndex], dummy);
    }

    indices[frameIndex]++;

    // set positions
    positions[frameIndex][indices[frameIndex] * 3]     = (ui_params.x_map != -1) ? aggregator(p, ui_params.x_map, 0, 1) : 0;
    positions[frameIndex][indices[frameIndex] * 3 + 1] = (ui_params.y_map != -1) ? aggregator(p, ui_params.y_map, 0, 1) : 0;
    positions[frameIndex][indices[frameIndex] * 3 + 2] = (ui_params.z_map != -1) ? aggregator(p, ui_params.z_map, 0, 1) : 0;

    // set colors
    if (ui_params.color_map == -1) continue;
    dummy = aggregator(p, ui_params.color_map, 0, 1);
    if (isNaN(dummy)) {
      positions[frameIndex][indices[frameIndex] * 3] = NaN;
      continue;
    }

    colors[frameIndex][indices[frameIndex] * 3]     = palette2color(dummy, 0, ui_params);
    colors[frameIndex][indices[frameIndex] * 3 + 1] = palette2color(dummy, 1, ui_params);
    colors[frameIndex][indices[frameIndex] * 3 + 2] = palette2color(dummy, 2, ui_params);
  }

  // return the computed results and close
  postMessage({
    particles: particles,
    min_value: min_value,
    max_value: max_value,
    positions: positions,
    colors: colors,
    engineID: engineID
  });
  close();
}

// interpolate the color of each data point using the selected color palette
function palette2color(x, i, ui_params) {
  if (x >= ui_params.palette_maxC)
    return colorPalette[ui_params.palette_index][colorPalette[ui_params.palette_index].length-1][i];

  if (x <= ui_params.palette_minC)
    return colorPalette[ui_params.palette_index][0][i];

  if (x >= ui_params.palette_midC) {
    x -= ui_params.palette_midC;
    var hp = (ui_params.palette_maxC - ui_params.palette_midC) / (Math.ceil(colorPalette[ui_params.palette_index].length / 2) - 1);
    var a = Math.floor(x / hp);
    var d = x - a * hp;
    a += Math.floor(colorPalette[ui_params.palette_index].length / 2);
    return (d * colorPalette[ui_params.palette_index][a + 1][i] + (hp - d) * colorPalette[ui_params.palette_index][a][i]) / hp;
  }

  x -= ui_params.palette_minC;
  var hn = (ui_params.palette_midC - ui_params.palette_minC) / (Math.floor(colorPalette[ui_params.palette_index].length / 2));
  var a = Math.floor(x / hn);
  var d = x - a * hn;
  return (d * colorPalette[ui_params.palette_index][a + 1][i] + (hn - d) * colorPalette[ui_params.palette_index][a][i]) / hn;
}

// mapping function from data objects to visual objects
// note: this function is highly data specific
function aggregator(row, col, rangeMin, rangeMax) {
  // change lat/long to x/y
  if (metaData.longitude !== undefined && col == metaData.longitude)
    return (lngToPixel(readData(row, col)) - map_params.lngOffset) / map_params.mapScale;

  if (metaData.latitude !== undefined && col == metaData.latitude)
    return (latToPixel(readData(row, col)) - map_params.latOffset) / -map_params.mapScale;

  // for time and total jobs and census blocks, do a generic normalization
  if ((metaData.timeDimension !== undefined && col == metaData.timeDimension) || col == 3 || col == 0)
    return (readData(row, col) - data_params.minOfColumn[col]) / (data_params.maxOfColumn[col] - data_params.minOfColumn[col]) * (rangeMax - rangeMin) + rangeMin;

  // for job categories, divide number of jobs by total number of jobs
  return (readData(row, 3) == 0) ? rangeMin : (readData(row, col) / readData(row, 3) * (rangeMax - rangeMin) + rangeMin);

  // note: for future use
  // if max and min are equal, return minimum desired range
  if (data_params.maxOfColumn[col] == data_params.minOfColumn[col])
    return rangeMin;
}

// helpers for working with array buffers
function readData(row, col) {
  var offset = data_params.headerSize + row * data_params.rowSize + data_params.byteOffsets[col];

  if (data_params.byteSchema[col] == 8)
    return rawdata.getFloat64(offset, true);
  else if (data_params.byteSchema[col] == 4)
    return rawdata.getInt32(offset, true);
  else if (data_params.byteSchema[col] == 2)
    return rawdata.getInt16(offset, true);
  else if (data_params.byteSchema[col] == 1)
    return rawdata.getInt8(offset, true);
  else
    return NaN;
}

function writeData(row, col, value) {
  var offset = data_params.headerSize + row * data_params.rowSize + data_params.byteOffsets[col];

  if (data_params.byteSchema[col] == 8)
    return rawdata.setFloat64(offset, value, true);
  else if (data_params.byteSchema[col] == 4)
    return rawdata.setInt32(offset, value, true);
  else if (data_params.byteSchema[col] == 2)
    return rawdata.setInt16(offset, value, true);
  else if (data_params.byteSchema[col] == 1)
    return rawdata.setInt8(offset, value, true);
  else
    return NaN;
}

// convert lat and long to pixels
// note: 256 << zoom
var pi_180 = Math.PI / 180.0;
var pi_4 = Math.PI * 4.0;

function latToPixel(lat) {
  var sinLat = Math.sin(lat * pi_180);
  return (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (pi_4)) * 256;
}

function pixelToLat(p) {
  var d = Math.exp(pi_4 * (0.5 - p / 256));
  return Math.asin((d - 1) / (d + 1)) / pi_180;
}

function lngToPixel(lng) {
  return ((lng + 180) / 360) * 256;
}

function pixelToLng(p) {
  return p * 360 / 256 - 180;
}