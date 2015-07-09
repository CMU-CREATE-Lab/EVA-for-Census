var renderer, camera, cameraType, scene, controls, stats, axisHelper, gridHelper, gridValues, gridOldValues, engineID = 0;
var VIEW_ANGLE = 50, NEAR = 0.1, FAR = 100000, ORTHONEAR = -100, ORTHOFAR = 1000, ORTHOSCALE = 100;
var vizDataChunks, snapshotList, metaData, map_params, colorPalette, map_layer = {};

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

function latlngToTile(lat, lng, zoom) {
  var x = (lng + 180) / 360;
  var sinLat = Math.sin(lat * pi_180);
  var y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (pi_4));

  var n = Math.pow(2, zoom);
  var index_x = Math.floor(n * x);
  var index_y = Math.floor(n * y);

  return {index_x: index_x, index_y: index_y};
}

function tileInfo(index_x, index_y, zoom) {
  var n = Math.pow(2, zoom);

  var min_lng = index_x / n * 360 - 180;
  var max_lng = (index_x + 1) / n * 360 - 180;

  var d = Math.exp(pi_4 * (0.5 - (index_y + 1) / n));
  var min_lat = Math.asin((d - 1) / (d + 1)) / pi_180;
  var d = Math.exp(pi_4 * (0.5 - index_y / n));
  var max_lat = Math.asin((d - 1) / (d + 1)) / pi_180;

  return {min_lng: min_lng, max_lng: max_lng, min_lat: min_lat, max_lat: max_lat}
}

function newMapLayer(params) {
  tile_min = params.tile_min;
  tile_max = params.tile_max;
  zoom = params.zoom;

  THREE.ImageUtils.crossOrigin = '';
  var layer = new THREE.Object3D();
  map_layer.nonLoadedTiles += params.number_of_tiles;

  for (var index_x = tile_min.index_x; index_x <= tile_max.index_x; index_x++) {
    for (var index_y = tile_max.index_y; index_y <= tile_min.index_y; index_y++) {
      var tile = tileInfo(index_x, index_y, zoom);

      var material = new THREE.MeshBasicMaterial({
        map: THREE.ImageUtils.loadTexture(map_params.MAP_TILE_URL + zoom + '/' + index_x + '/' + index_y + '.png', undefined, function() {--map_layer.nonLoadedTiles}, function() {--map_layer.nonLoadedTiles}),
        side: THREE.DoubleSide,
        blending: THREE.NoBlending,
        depthTest: false
      });

      var width = (lngToPixel(tile.max_lng) - lngToPixel(tile.min_lng)) / map_params.mapScale;

      var geometry = new THREE.PlaneBufferGeometry(width, width);
      var temp_tile = new THREE.Mesh(geometry, material);
      temp_tile.translateX((lngToPixel(tile.min_lng) - map_params.lngOffset) / map_params.mapScale + width / 2);
      temp_tile.translateY(-(latToPixel(tile.max_lat) - map_params.latOffset) / map_params.mapScale - width / 2);

      layer.add(temp_tile);
    }
  }

  return layer;
}

function bestMapZoomLevel(params) {
  var zoom, tile_min, tile_max, number_of_tiles;
  for (zoom = map_params.MAX_TILE_ZOOM; zoom >= 0; zoom--) {
    tile_min = latlngToTile(params.minLat, params.minLong, zoom);
    tile_max = latlngToTile(params.maxLat, params.maxLong, zoom);
    number_of_tiles = (tile_max.index_x - tile_min.index_x + 1) * (tile_min.index_y - tile_max.index_y + 1);
    if (number_of_tiles <= map_params.MAX_TILES_TH) break;
  }

  return {zoom: zoom, tile_min: tile_min, tile_max: tile_max, number_of_tiles: number_of_tiles};
}

function initializeMapLayer() {
  // initialization
  if (renderer && scene) {
    if (map_layer.static_layer) scene.remove(map_layer.static_layer);
    if (map_layer.dynamic_layer) scene.remove(map_layer.dynamic_layer);
  }
  map_layer = {};
  map_layer.visible = false;
  map_layer.nonLoadedTiles = 0;

  map_layer.static_layer = new THREE.Object3D();
  map_layer.dynamic_layer = new THREE.Object3D();

  // find the best zoom level for the static map
  var layer_info = bestMapZoomLevel(map_params);

  map_layer.static_layer_zoom = layer_info.zoom;

  // add all tiles in that zoom level
  map_layer.static_layer = newMapLayer(layer_info);
}

function updateMapLayers(current_map_params, ui_params) {
  if (!renderer || !scene || !map_layer.visible) return;

  map_layer.static_layer.scale.set(ui_params.scale_x, ui_params.scale_y, 1);

  // if current zoom level supports a higher resolution map, add it as the static layer
  var layer_info = bestMapZoomLevel(current_map_params);

  if (layer_info.zoom > map_layer.static_layer_zoom && (!map_layer.dynamic_layer || layer_info.tile_min.index_x != map_layer.dynamic_layer_tile_min_index_x || layer_info.tile_min.index_y != map_layer.dynamic_layer_tile_min_index_y || layer_info.tile_max.index_x != map_layer.dynamic_layer_tile_max_index_x || layer_info.tile_max.index_y != map_layer.dynamic_layer_tile_max_index_y)) {

    map_layer.new_dynamic_layer = newMapLayer(layer_info);
    map_layer.dynamic_layer_tile_min_index_x = layer_info.tile_min.index_x;
    map_layer.dynamic_layer_tile_max_index_x = layer_info.tile_max.index_x;
    map_layer.dynamic_layer_tile_min_index_y = layer_info.tile_min.index_y;
    map_layer.dynamic_layer_tile_max_index_y = layer_info.tile_max.index_y;

    async.whilst(
                function () {return map_layer.nonLoadedTiles > 0}, 
                function (callback) {setTimeout(callback, 500)},
                function (err) {
                  if (map_layer.dynamic_layer) {
                    scene.remove(map_layer.dynamic_layer);
                  }

                  if (map_layer.new_dynamic_layer) {
                    map_layer.dynamic_layer = map_layer.new_dynamic_layer;
                    scene.add(map_layer.dynamic_layer);
                  }

                  map_layer.nonLoadedTiles = 0;
                }
                );

  }

  if (layer_info.zoom <= map_layer.static_layer_zoom && map_layer.dynamic_layer) {
    scene.remove(map_layer.dynamic_layer);
  }

  if (map_layer.dynamic_layer) {
    map_layer.dynamic_layer.scale.set(ui_params.scale_x, ui_params.scale_y, 1)
  }
}

function readMetaData(rawdata) {
  var res = {};

  res.totalParticles = rawdata.getInt32(0, true);     // rows
  res.dimensions = rawdata.getInt32(4, true);         // columns
  res.headerSize = rawdata.getInt32(8, true);         // size of the header file at the beginning of the binary blob 
  res.rowSize = rawdata.getInt32(12, true);           // size of each row of data in the binary file

  res.byteOffsets = [];
  for (var i = 0; i < res.dimensions; i++) {
    res.byteOffsets.push(rawdata.getInt32(16 + i * 4, true));
  }

  res.byteSchema = [];
  for (var i = 0; i < res.dimensions; i++) {
    res.byteSchema.push(rawdata.getInt32(16 + 4 * res.dimensions + 4 * i, true));
  }

  res.minOfColumn = [];
  for (var i = 0; i < res.dimensions; i++) {
    res.minOfColumn.push(rawdata.getFloat64(16 + 8 * res.dimensions + 8 * i, true));
  }

  res.maxOfColumn = [];
  for (var i = 0; i < res.dimensions; i++) {
    res.maxOfColumn.push(rawdata.getFloat64(16 + 16 * res.dimensions + 8 * i, true));
  }

  return res;
}
function destructVisualizationEngine() {
  vizDataChunks = [];
  scene = null;
  renderer = null;
}

function initializeVisualizationEngine($container, MetaData, cPalette) {

  colorPalette = cPalette;
  metaData = MetaData;

  // empty memory
  destructVisualizationEngine();

  // center map on US
  map_params = {
    minLat: dm._worldMinLat,
    maxLat: dm._worldMaxLat,
    minLong: dm._worldMinLong,
    maxLong: dm._worldMaxLong,
    latOffset: (latToPixel(dm._worldMinLat) + latToPixel(dm._worldMaxLat)) / 2.,
    lngOffset: (lngToPixel(dm._worldMinLong) + lngToPixel(dm._worldMaxLong)) / 2.,
    mapScale: 4
  };

  /* list of available tile servers: http://wiki.openstreetmap.org/wiki/Tile_servers */
  /* ------------------------------------------------------------------------------- */
  //var MAP_TILE_URL = 'http://c.tile.openstreetmap.org/'; // normal color map
  var MAP_TILE_URL = 'http://a.basemaps.cartocdn.com/light_all/'; // grayscale map light
  //var MAP_TILE_URL = 'http://a.basemaps.cartocdn.com/dark_all/'; // grayscale map dark
  //var MAP_TILE_URL = 'http://a.tile.stamen.com/toner/'; // black and white + boudanries

  /* this is our local tile server. use MAX_TILE_ZOOM = 15 with this set ----------- */
  //var MAP_TILE_URL = 'resources/maps/carto-light/'; // grayscale map light
  /* ------------------------------------------------------------------------------- */

  map_params.MAP_TILE_URL = MAP_TILE_URL;
  map_params.MAX_TILE_ZOOM = 19;
  map_params.MAX_TILES_TH = 30;

  // prepare map layer
  initializeMapLayer();

  // initialize the renderer engine
  renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xffffff, 1);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0px';
  renderer.domElement.style.left = '0px';
  renderer.domElement.style.zIndex = 1;
  $container.html(renderer.domElement);

  engineID++;

  // create scenes
  scene = new THREE.Scene();

  // camera
  cameraType = "perspective";
  setCameraType("perspective");
  setControls();
  scene.add(camera);

  // lights
  var hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0.6 );
  hemiLight.color.setHSL( 0.6, 1, 0.6 );
  hemiLight.groundColor.setHSL( 0.095, 1, 0.75 );
  hemiLight.position.set( 0, 500, 0 );
  scene.add( hemiLight );

  var dirLight = new THREE.DirectionalLight( 0xffffff, 1 );
  dirLight.color.setHSL( 0.1, 1, 0.95 );
  dirLight.position.set( -1, 1.75, 1 );
  dirLight.position.multiplyScalar( 50 );
  scene.add( dirLight );
  dirLight.castShadow = true;
  dirLight.shadowMapWidth = 2048;
  dirLight.shadowMapHeight = 2048;

  var d = 50;
  dirLight.shadowCameraLeft = -d;
  dirLight.shadowCameraRight = d;
  dirLight.shadowCameraTop = d;
  dirLight.shadowCameraBottom = -d;
  dirLight.shadowCameraFar = 3500;
  dirLight.shadowBias = -0.0001;
  dirLight.shadowDarkness = 0.35;

  var dirLight2 = dirLight.clone();
  dirLight2.position.set( 1, -1.75, -1 );
  scene.add( dirLight2 );

  // start animating
  animate();
}

function findGeoIntersection(a, b) {
  var projectionPlane = new THREE.Plane(new THREE.Vector3(0,0,1), 0);
  var v, cr;

  if (camera instanceof THREE.PerspectiveCamera) {
    v = new THREE.Vector3(a, b, 0.5);
    cr = new THREE.Ray(camera.position, v.unproject(camera).sub(camera.position).normalize());
  } else {
    v = new THREE.Vector3(a, b, -1);
    var u = new THREE.Vector3(0, 0, -1);
    cr = new THREE.Ray(v.unproject(camera), u.transformDirection(camera.matrixWorld));
  }
  
  return cr.intersectPlane(projectionPlane);
}

function findVisibleLatLong() {
  var res = {}, ui_params = getUI_Params(), tmp;

  res.minLong = map_params.minLong;
  res.minLat = map_params.minLat;    
  res.maxLong = map_params.maxLong;
  res.maxLat = map_params.maxLat;

  if (metaData.latitude !== undefined && metaData.longitude !== undefined && ui_params.x_map == metaData.longitude && ui_params.y_map == metaData.latitude) {
    var buttom_left = findGeoIntersection(-1, -1);
    var buttom_right = findGeoIntersection(1, -1);
    var top_left = findGeoIntersection(-1, 1);
    var top_right = findGeoIntersection(1, 1);

    if (!buttom_left || !buttom_right || !top_left || !top_right)
      return res;

    res.minLong = Math.max(pixelToLng(Math.min(buttom_right.x, buttom_left.x, top_right.x, top_left.x) * map_params.mapScale / ui_params.scale_x + map_params.lngOffset), map_params.minLong);
    res.maxLong = Math.min(pixelToLng(Math.max(buttom_right.x, buttom_left.x, top_right.x, top_left.x) * map_params.mapScale / ui_params.scale_x + map_params.lngOffset), map_params.maxLong);
    res.minLong = Math.min(res.minLong, map_params.maxLong);
    res.maxLong = Math.max(res.maxLong, map_params.minLong);

    res.minLat = Math.max(pixelToLat(Math.min(buttom_right.y, buttom_left.y, top_right.y, top_left.y) * -map_params.mapScale / ui_params.scale_y + map_params.latOffset), map_params.minLat);
    res.maxLat = Math.min(pixelToLat(Math.max(buttom_right.y, buttom_left.y, top_right.y, top_left.y) * -map_params.mapScale / ui_params.scale_y + map_params.latOffset), map_params.maxLat);
    res.minLat = Math.min(res.minLat, map_params.maxLat);
    res.maxLat = Math.max(res.maxLat, map_params.minLat);
  }
  
  return res;
}

function drawDataChunk(i) {
  if (vizDataChunks[i].visible == false || vizDataChunks[i].in_worker == true) {
    return;
  }

  // if this is an empty scene, clear the screen and return
  if (vizDataChunks[i].ui_params.x_map == -1 && vizDataChunks[i].ui_params.y_map == -1 && vizDataChunks[i].ui_params.z_map == -1) {
    // delete old data, if any exists
    for (var j = 0; vizDataChunks[i].pointCloud !== undefined && j < vizDataChunks[i].pointCloud.length; j++) {
      scene.remove(vizDataChunks[i].pointCloud[j]);
    }

    vizDataChunks[i].pointCloud = undefined;
    return;
  }

  vizDataChunks[i].in_worker = true;

  // find number of frames
  if (vizDataChunks[i].ui_params.time_map == -1) {
    vizDataChunks[i].numberOfFrames = 1;
  } else {
    vizDataChunks[i].numberOfFrames = vizDataChunks[i].ui_params.frame_number;
  }

  // do the viz processing in a web worker
  var visWorker = new Worker('./js/visWorker.js');

  visWorker.postMessage({
    rawdata: vizDataChunks[i].rawdata.buffer,
    ui_params: vizDataChunks[i].ui_params,
    data_params: vizDataChunks[i].data_params,
    numberOfFrames: vizDataChunks[i].numberOfFrames,
    map_params: map_params,
    colorPalette: colorPalette,
    metaData: metaData,
    engineID: engineID
  });
  
  visWorker.onmessage = function(m) {
    // if there results are stale, throw them away
    var engine_id = m.data.engineID;
    if (!renderer || engineID != engine_id || vizDataChunks.length == 0 || vizDataChunks[i] === undefined) {
      visWorker.terminate();
      return;
    };

    // receive particles, min_value, max_value, positions, colors
    vizDataChunks[i].particles = m.data.particles;
    vizDataChunks[i].min_value = m.data.min_value;
    vizDataChunks[i].max_value = m.data.max_value;
    var positions = m.data.positions;
    var colors = m.data.colors;

    // delete old data, if any exists
    for (var j = 0; vizDataChunks[i].pointCloud !== undefined && j < vizDataChunks[i].pointCloud.length; j++) {
      scene.remove(vizDataChunks[i].pointCloud[j]);
    }

    // build point clouds for each frame
    vizDataChunks[i].pointCloud = [];
    for (var f = 0; f < vizDataChunks[i].numberOfFrames; f++) {
      var geometry = new THREE.BufferGeometry();
      geometry.addAttribute('position', new THREE.BufferAttribute(positions[f], 3));
      geometry.addAttribute('color', new THREE.BufferAttribute(colors[f], 3));
      geometry.computeBoundingBox();

      vizDataChunks[i].pointCloud.push(new THREE.PointCloud(geometry, new THREE.PointCloudMaterial({transparent: true, size: 1, vertexColors: true, opacity: (vizDataChunks[i].aggregation_level > 0 ? (0.5 + 0.3 / vizDataChunks[i].aggregation_level) : 0.9)})));
      vizDataChunks[i].pointCloud[f].scale.set(vizDataChunks[i].ui_params.scale_x, vizDataChunks[i].ui_params.scale_y, vizDataChunks[i].ui_params.scale_z);
    }

    // add current frame to the scene
    vizDataChunks[i].current_frame = Math.max(Math.min(Math.floor(vizDataChunks[i].numberOfFrames * vizDataChunks[i].ui_params.time_slider), vizDataChunks[i].numberOfFrames - 1), 0);
    scene.add(vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame]);
    
    // update ui text with the correct time interval
    $('#ui-indicator-time').val((vizDataChunks.length > 0 && vizDataChunks[i].ui_params.time_map != -1 && vizDataChunks[i].pointCloud.length > 1 && vizDataChunks[i].particles[vizDataChunks[i].current_frame] > 0 && !(vizDataChunks[i].ui_params.x_map == -1 && vizDataChunks[i].ui_params.y_map == -1 && vizDataChunks[i].ui_params.z_map == -1)) ? (vizDataChunks[i].min_value[vizDataChunks[i].current_frame].toFixed(0)) : '');

    vizDataChunks[i].in_worker = false;
  }

}

function updateVisualization() {
  if (!renderer || !scene) return;

  // 1. update local information
  // e.g. ui_params, data chunks to be visualized, ...

  var keysToBeVisualized = [];
  for (var key in dm._viewList) {
    if (dm._viewList[key] == true && dm._memory[key] != null) {
      keysToBeVisualized.push(key);
    }
  }

  var ui_params = getUI_Params();

  // 2. delete unnecessary data chunks:
  // data chunks that are not in keysToBeVisualized, or those with a different ui_params.data_index
  for (var i = vizDataChunks.length - 1; i >= 0; i--) {
    if ((keysToBeVisualized.indexOf(vizDataChunks[i].key) == -1 && dm._memory[vizDataChunks[i].key] == null) || vizDataChunks[i].ui_params.data_index != ui_params.data_index) {
      for (var j = 0; vizDataChunks[i].pointCloud !== undefined && j < vizDataChunks[i].pointCloud.length; j++) {
        scene.remove(vizDataChunks[i].pointCloud[j]);
      }
      vizDataChunks.splice(i, 1);
    }
  }

  // if a data chunk is not in the keys to be visualized, but is still cached, only remove it from the scene, but keep the data structure
  for (var i = vizDataChunks.length - 1; i >= 0; i--) {
    if (keysToBeVisualized.indexOf(vizDataChunks[i].key) == -1) {
      vizDataChunks[i].visible = false;
      for (var j = 0; vizDataChunks[i].pointCloud !== undefined && j < vizDataChunks[i].pointCloud.length; j++) {
        scene.remove(vizDataChunks[i].pointCloud[j]);
      }
    }
  }

  // 3. visualize at most "one" new data chunk + add it to vizDataChunks data structure
  // find which keys are already visualized, as we don't want to redraw them
  for (var i = 0; i < vizDataChunks.length; i++) {
    var x = keysToBeVisualized.indexOf(vizDataChunks[i].key);
    if (x != -1) {
      keysToBeVisualized.splice(x, 1);
      if (vizDataChunks[i].visible == false && vizDataChunks[i].pointCloud !== undefined) {
        scene.add(vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame]);
      }
      vizDataChunks[i].visible = true;
    }
  }

  // if there are still non-visualized keys, pick the first one and draw it
  if (keysToBeVisualized.length > 0) {
    var key = keysToBeVisualized[0];

    // add this new key to our list of data chunks
    var i = vizDataChunks.length;
    vizDataChunks.push({});
    vizDataChunks[i].key = key;
    vizDataChunks[i].visible = false;
    vizDataChunks[i].aggregation_level = dm.keyToAggLevelNum(key);
    vizDataChunks[i].ui_params = $.extend({}, ui_params);
    vizDataChunks[i].rawdata = new DataView(dm._memory[key].buffer);
    vizDataChunks[i].data_params = readMetaData(vizDataChunks[i].rawdata);

    // now add the new data chunk to the scene
    if (vizDataChunks[i].ui_params.x_map != -1 || vizDataChunks[i].ui_params.y_map != -1 || vizDataChunks[i].ui_params.z_map != -1) {
      vizDataChunks[i].visible = true;
      drawDataChunk(i);
    }
  }
  // 4. if no new data chunk has been added, update at most one existing data chunk
  // todo: I can do smooth animations here too
  else {
    // find the first data chunk with old ui_params
    for (var i = 0; i < vizDataChunks.length; i++) {
      if (vizDataChunks[i].visible == false) {
        continue;
      }

      // if this is the first time we're drawing this chunk
      if (vizDataChunks[i].pointCloud === undefined && (ui_params.x_map != -1 || ui_params.y_map != -1 || ui_params.z_map != -1) && (vizDataChunks[i].in_worker === undefined || vizDataChunks[i].in_worker == false)) {
        vizDataChunks[i].ui_params = $.extend({}, ui_params);
        drawDataChunk(i);
        break;
      } else if (vizDataChunks[i].pointCloud !== undefined && (vizDataChunks[i].in_worker === undefined || vizDataChunks[i].in_worker == false) && (ui_params.x_map != vizDataChunks[i].ui_params.x_map || ui_params.y_map != vizDataChunks[i].ui_params.y_map || ui_params.z_map != vizDataChunks[i].ui_params.z_map || ui_params.time_map != vizDataChunks[i].ui_params.time_map || ui_params.color_map != vizDataChunks[i].ui_params.color_map || ui_params.palette_index != vizDataChunks[i].ui_params.palette_index || ui_params.palette_minC != vizDataChunks[i].ui_params.palette_minC || ui_params.palette_midC != vizDataChunks[i].ui_params.palette_midC || ui_params.palette_maxC != vizDataChunks[i].ui_params.palette_maxC)) {
        vizDataChunks[i].ui_params = $.extend({}, ui_params);
        drawDataChunk(i);
        break;
      }
    }
  }

  // 5. do general updates, e.g. scale, point radius, frame number (update frame for only those data chunks that have multiple frames. it may take a while until they all update)
  for (var i = 0; i < vizDataChunks.length; i++) {
    if (vizDataChunks[i].visible == false) {
      continue;
    }

    // update current frame
    var frame_to_be = ui_params.time_slider;
    if (vizDataChunks[i].pointCloud !== undefined && vizDataChunks[i].current_frame != frame_to_be && frame_to_be < vizDataChunks[i].pointCloud.length) {
      scene.remove(vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame]);
      vizDataChunks[i].current_frame = frame_to_be;
      scene.add(vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame]);

      // update ui text with the correct time interval
      $('#ui-indicator-time').val((vizDataChunks.length > 0 && vizDataChunks[i].ui_params.time_map != -1 && vizDataChunks[i].pointCloud.length > 1 && vizDataChunks[i].particles[vizDataChunks[i].current_frame] > 0 && !(vizDataChunks[i].ui_params.x_map == -1 && vizDataChunks[i].ui_params.y_map == -1 && vizDataChunks[i].ui_params.z_map == -1)) ? (vizDataChunks[i].min_value[vizDataChunks[i].current_frame].toFixed(0)) : '');
    }

    // update scales and point radius
    vizDataChunks[i].ui_params.scale_x = ui_params.scale_x;
    vizDataChunks[i].ui_params.scale_y = ui_params.scale_y;
    vizDataChunks[i].ui_params.scale_z = ui_params.scale_z;
    vizDataChunks[i].ui_params.point_radius = ui_params.point_radius;
    if (vizDataChunks[i].pointCloud && vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame]) {
      vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame].scale.set(vizDataChunks[i].ui_params.scale_x, vizDataChunks[i].ui_params.scale_y, vizDataChunks[i].ui_params.scale_z);
      vizDataChunks[i].pointCloud[vizDataChunks[i].current_frame].material.size =  Math.pow(Math.log(vizDataChunks[i].ui_params.point_radius + 1), 4) + (vizDataChunks[i].aggregation_level > 0 ? 0.5 : 0.04);
    }
  }

  var current_map_params = findVisibleLatLong();
  if (ui_params.lock_stream == false) {
    // 6. update list of data chunks based on the visible area
    dm.getBuffers(current_map_params);
  
    // 7. update map layer based on the visible area
    updateMapLayers(current_map_params, ui_params);
  }
}

function animate()
{
  if (!renderer) return;
  requestAnimationFrame(animate);
  updateVisualization();
  updateGridHelperValues();
  controls.update();
  renderer.render(scene, camera);
}

function calcWindowResize(rend, camera)
{
  var callback = function(){
    var WIDTH = window.innerWidth, HEIGHT = window.innerHeight;
    rend.setSize(WIDTH, HEIGHT);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = WIDTH/HEIGHT;
    } else {
      camera.left = - WIDTH/ORTHOSCALE;
      camera.right = WIDTH/ORTHOSCALE;
      camera.top = HEIGHT/ORTHOSCALE;
      camera.bottom = - HEIGHT/ORTHOSCALE;
    }
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', callback, false);
}

function setCameraType(type, Pos, Rot, Up, Side)
{
  if (!renderer) return;

  var WIDTH = window.innerWidth, HEIGHT = window.innerHeight;
  var x = 0, y = 0, z = 300;

  if (type === "perspective") {
    camera = new THREE.PerspectiveCamera(VIEW_ANGLE, WIDTH/HEIGHT, NEAR, FAR);
    cameraType = "perspective";
  }
  else {
    camera = new THREE.OrthographicCamera(-WIDTH/ORTHOSCALE, WIDTH/ORTHOSCALE, HEIGHT/ORTHOSCALE, -HEIGHT/ORTHOSCALE, ORTHONEAR, ORTHOFAR);
    cameraType = "orthographic";
  }

  if (Pos !== undefined) {
    camera.position.set(Pos.x, Pos.y, Pos.z);
  } else {
    camera.position.set(x, y, z);  
  }

  // set camera rotation
  if (Rot !== undefined && Up !== undefined && Side !== undefined) {
    camera.rotation.set(Rot.x, Rot.y, Rot.z);
    camera.up.set(Up.x, Up.y, Up.z);
    if (type === "orthographic") {
      camera.left = Side.l;
      camera.top = Side.t;
      camera.bottom = Side.b;
      camera.right = Side.r;
    }
  } else {
    if (x == 0 && y == 0)
      camera.up.set(0, 1, 0);
    else
      camera.up.set(0, 0, 1);    
    camera.lookAt(scene.position.clone());   
  }
  camera.updateProjectionMatrix();

  // events
  calcWindowResize(renderer, camera);
}

function setControls(Cnt) {
  if (!renderer) return;

  if (cameraType === "perspective") {
    controls = new THREE.TrackballControls(camera, renderer.domElement);
  }
  else {
    controls = new THREE.OrthographicTrackballControls(camera, renderer.domElement);
  }

  if (Cnt !== undefined) {
    controls.target.set(Cnt.x, Cnt.y, Cnt.z);
  }

  // controls
  controls.noZoom = false;
  controls.noPan = false;
  controls.staticMoving = false;
  controls.dynamicDampingFactor = 0.3;
  controls.minDistance = 0.1;
  controls.maxDistance = 3000;
}

function Goto_Lat_Lng (params) {
  var ui_params = getUI_Params();

  if (metaData.latitude !== undefined && metaData.longitude !== undefined && ui_params.x_map == metaData.longitude && ui_params.y_map == metaData.latitude && params && params.latitude !== undefined && params.longitude !== undefined) {

    var x = (lngToPixel(params.longitude) - map_params.lngOffset) / map_params.mapScale * ui_params.scale_x;
    var y = (latToPixel(params.latitude) - map_params.latOffset) / -map_params.mapScale * ui_params.scale_y;

    camera.position.set(x, y, 10);
    camera.up.set(0, 1, 0);
    camera.lookAt(new THREE.Vector3(x, y, 0));
    setControls(new THREE.Vector3(x, y, 0));
  }
}


function setCameraZ() {
  if (!camera) return;

  var cameraBaseVector = new THREE.Vector3(0, 0, -1);
  cameraBaseVector.applyQuaternion(camera.quaternion);

  var cameraRay = new THREE.Ray(camera.position, cameraBaseVector);
  var projectionPlane = new THREE.Plane(new THREE.Vector3(0,0,1), 0);
  var intersectionPoint = cameraRay.intersectPlane(projectionPlane);
  
  var z = camera.position.z;
  if (intersectionPoint) {
    z = Math.sqrt(Math.pow(camera.position.x - intersectionPoint.x, 2) + Math.pow(camera.position.y - intersectionPoint.y, 2) + Math.pow(camera.position.z - intersectionPoint.z, 2));
    if (camera.position.z < 0) z *= -1;
  }
  
  if (!intersectionPoint || (camera.position.x == intersectionPoint.x && camera.position.y == intersectionPoint.y && camera.position.z == 0) || Math.abs(intersectionPoint.x) > 1000 || Math.abs(intersectionPoint.y) > 1000 || Math.abs(intersectionPoint.z) > 1000) {
    camera.position.set(0, 0, 500);
    camera.up.set(0, 1, 0);
    camera.lookAt(new THREE.Vector3(0,0,0));
    setControls();
  } else {
    camera.position.set(intersectionPoint.x, intersectionPoint.y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(new THREE.Vector3(intersectionPoint.x, intersectionPoint.y, 0));
    setControls(new THREE.Vector3(intersectionPoint.x, intersectionPoint.y, 0));
  }
}

function setCameraY() {
  if (!camera) return;

  var cameraBaseVector = new THREE.Vector3(0, 0, -1);
  cameraBaseVector.applyQuaternion(camera.quaternion);

  var cameraRay = new THREE.Ray(camera.position, cameraBaseVector);
  var projectionPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  var intersectionPoint = cameraRay.intersectPlane(projectionPlane);
  
  var y = camera.position.y;
  if (intersectionPoint) {
    y = Math.sqrt(Math.pow(camera.position.x - intersectionPoint.x, 2) + Math.pow(camera.position.y - intersectionPoint.y, 2) + Math.pow(camera.position.z - intersectionPoint.z, 2));
    if (camera.position.y < 0) y *= -1;
  }
  
  if (!intersectionPoint || (camera.position.x == intersectionPoint.x && camera.position.y == 0 && camera.position.z == intersectionPoint.z) || Math.abs(intersectionPoint.x) > 1000 || Math.abs(intersectionPoint.y) > 1000 || Math.abs(intersectionPoint.z) > 1000) {
    camera.position.set(0, 500, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(0,0,0));
    setControls();
  } else {
    camera.position.set(intersectionPoint.x, y, intersectionPoint.z);
    camera.up.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z));
    setControls(new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z));
  }
}

function setCameraX() {
  if (!camera) return;

  var cameraBaseVector = new THREE.Vector3(0, 0, -1);
  cameraBaseVector.applyQuaternion(camera.quaternion);

  var cameraRay = new THREE.Ray(camera.position, cameraBaseVector);
  var projectionPlane = new THREE.Plane(new THREE.Vector3(1,0,0), 0);
  var intersectionPoint = cameraRay.intersectPlane(projectionPlane);
  
  var x = camera.position.x;
  if (intersectionPoint) {
    x = Math.sqrt(Math.pow(camera.position.x - intersectionPoint.x, 2) + Math.pow(camera.position.y - intersectionPoint.y, 2) + Math.pow(camera.position.z - intersectionPoint.z, 2));
    if (camera.position.x < 0) x *= -1;
  }
  
  if (!intersectionPoint || (camera.position.x == 0 && camera.position.z == intersectionPoint.z && camera.position.y == intersectionPoint.y) || Math.abs(intersectionPoint.x) > 1000 || Math.abs(intersectionPoint.y) > 1000 || Math.abs(intersectionPoint.z) > 1000) {
    camera.position.set(500, 0, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(0,0,0));
    setControls();
  } else {
    camera.position.set(x, intersectionPoint.y, intersectionPoint.z);
    camera.up.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(0, intersectionPoint.y, intersectionPoint.z));
    setControls(new THREE.Vector3(0, intersectionPoint.y, intersectionPoint.z));
  }
}

function setAxisHelper(s)
{
  if(s) {
    if (axisHelper && scene) scene.remove(axisHelper);

    axisHelper = new THREE.Object3D();

    var axisLines = new THREE.AxisHelper(100);
    axisHelper.add(axisLines);

    var spritex = makeTextSprite( " X ", { fontsize: 50, borderColor: {r:255, g:0, b:0, a:1.0}, backgroundColor: {r:255, g:100, b:100, a:0.8} } );
    spritex.position.set(110, 0, 0);
    axisHelper.add(spritex);

    var spritey = makeTextSprite( " Y ", { fontsize: 50, borderColor: {r:0, g:255, b:0, a:1.0}, backgroundColor: {r:100, g:255, b:100, a:0.8} } );
    spritey.position.set(0, 110, 0);
    axisHelper.add(spritey);

    var spritez = makeTextSprite( " Z ", { fontsize: 50, borderColor: {r:0, g:0, b:255, a:1.0}, backgroundColor: {r:100, g:100, b:255, a:0.8} } );
    spritez.position.set(0, 0, 110);
    axisHelper.add(spritez);

    if (scene) scene.add(axisHelper);
  } else {
    if (scene) scene.remove(axisHelper);
  }
}

function makeTextSprite( message, parameters )
{
  if ( parameters === undefined ) parameters = {};
  var fontface = parameters.hasOwnProperty("fontface") ? parameters["fontface"] : "Arial";
  var fontsize = parameters.hasOwnProperty("fontsize") ? parameters["fontsize"] : 18;
  var borderThickness = parameters.hasOwnProperty("borderThickness") ? parameters["borderThickness"] : 4;
  var borderColor = parameters.hasOwnProperty("borderColor") ?parameters["borderColor"] : { r:0, g:0, b:0, a:1.0 };
  var backgroundColor = parameters.hasOwnProperty("backgroundColor") ?parameters["backgroundColor"] : { r:255, g:255, b:255, a:1.0 };
  var textColor = parameters.hasOwnProperty("textColor") ?parameters["textColor"] : { r:0, g:0, b:0, a:1.0 };

  var canvas = document.createElement('canvas');
  var context = canvas.getContext('2d');
  context.font = "Bold " + fontsize + "px " + fontface;
  var metrics = context.measureText( message );
  var textWidth = metrics.width;

  var W = textWidth * 1.1 + borderThickness * 2;
  var H = fontsize * 1.5 + borderThickness * 2;

  canvas.width = Math.pow(2, Math.ceil(Math.log(W) / Math.log(2)));
  canvas.height = Math.pow(2, Math.ceil(Math.log(H) / Math.log(2)));

  context.fillStyle   = "rgba(" + backgroundColor.r + "," + backgroundColor.g + "," + backgroundColor.b + "," + backgroundColor.a + ")";
  context.strokeStyle = "rgba(" + borderColor.r + "," + borderColor.g + "," + borderColor.b + "," + borderColor.a + ")";

  context.lineWidth = borderThickness;
  roundRect(context, (borderThickness + canvas.width - W) / 2, (borderThickness + canvas.height - H) / 2, W, H, 8);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "Bold " + fontsize + "px " + fontface;
  context.fillStyle = "rgba("+textColor.r+", "+textColor.g+", "+textColor.b+", 1.0)";
  context.fillText( message, canvas.width / 2, canvas.height / 2);

  var texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;

  var spriteMaterial = new THREE.SpriteMaterial( { map: texture } );
  var sprite = new THREE.Sprite( spriteMaterial );
  sprite.scale.set(0.1 * canvas.width, 0.1 * canvas.height, 1);
  return sprite;  
}

function roundRect(ctx, x, y, w, h, r) 
{
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();   
}

function setGridHelper (s) {
  gridOldValues = null;
  if(s) {
    if (gridHelper && scene) scene.remove(gridHelper);
    
    gridHelper = new THREE.Object3D();

    var gridXY = new THREE.GridHelper(50, 10);
    gridXY.position.set(50, 50, 0);
    gridXY.rotation.x = Math.PI/2;
    gridXY.setColors(new THREE.Color(0xaaaa00), new THREE.Color(0xaaaa00));

    var gridXZ = new THREE.GridHelper(50, 10);
    gridXZ.position.set(50, 0, 50);
    gridXZ.setColors(new THREE.Color(0xaa00aa), new THREE.Color(0xaa00aa));

    var gridYZ = new THREE.GridHelper(50, 10);
    gridYZ.position.set(0, 50, 50);
    gridYZ.rotation.z = Math.PI/2;
    gridYZ.setColors(new THREE.Color(0x00aaaa), new THREE.Color(0x00aaaa));

    gridHelper.add(gridXY);
    gridHelper.add(gridXZ);
    gridHelper.add(gridYZ);
    
    if (scene) scene.add(gridHelper);
  } else {
    if (scene) scene.remove(gridHelper);
  }
}

function updateGridHelperValues () {
  if (!scene || !gridHelper) return;
  var ui_params = getUI_Params();
  if (!ui_params.grid_helper) return;
  if (!gridOldValues) gridOldValues = {scale_x: 0, scale_y: 0, scale_z: 0};

  if (ui_params.scale_x == gridOldValues.scale_x && ui_params.scale_y == gridOldValues.scale_y && ui_params.scale_z == gridOldValues.scale_z) return;

  gridOldValues.scale_x = ui_params.scale_x;
  gridOldValues.scale_y = ui_params.scale_y;
  gridOldValues.scale_z = ui_params.scale_z;

  if (gridValues) gridHelper.remove(gridValues);

  gridValues = new THREE.Object3D();

  for (var i = 1; i <= 10; i++) {
    if ((i * 1000 / ui_params.scale_x) > 100) break;
    var t = makeTextSprite( " " + (i * 1000 / ui_params.scale_x).toFixed(0) + "% ", { fontsize: 25, borderColor: {r:255, g:0, b:0, a:1.0}, backgroundColor: {r:255, g:150, b:150, a:0.5} } );
    t.position.set(i * 10, -5, 0);
    gridValues.add(t);
  }

  for (var i = 1; i <= 10; i++) {
    if ((i * 1000 / ui_params.scale_y) > 100) break;
    var t = makeTextSprite( " " + (i * 1000 / ui_params.scale_y).toFixed(0) + "% ", { fontsize: 25, borderColor: {r:0, g:255, b:0, a:1.0}, backgroundColor: {r:100, g:255, b:100, a:0.8} } );
    t.position.set(-5, i * 10, 0);
    gridValues.add(t);
  }

  for (var i = 1; i <= 10; i++) {
    if ((i * 1000 / ui_params.scale_z) > 100) break;
    var t = makeTextSprite( " " + (i * 1000 / ui_params.scale_z).toFixed(0) + "% ", { fontsize: 25, borderColor: {r:0, g:0, b:255, a:1.0}, backgroundColor: {r:100, g:100, b:255, a:0.8} } );
    t.position.set(-5, -5, i * 10);
    gridValues.add(t);
  }

  gridHelper.add(gridValues);
}

function setGeoLayer(s) {
  if (s) {
    if (scene && map_layer.static_layer) {
      scene.add(map_layer.static_layer);
      if (map_layer.dynamic_layer) {
        scene.add(map_layer.dynamic_layer);
      }
      map_layer.visible = true;
    }
  } else {
    if (scene && map_layer.static_layer) {
      scene.remove(map_layer.static_layer);
      if (map_layer.dynamic_layer) {
        scene.remove(map_layer.dynamic_layer);
      }
      map_layer.visible = false;
    }
  }
}

function takeSnapshot() {
  var ui_params = getUI_Params();

  var status = {};
  status.timeStamp = (new Date()).getTime();
  status.datasetIndex = ui_params.data_index;
  status.dimensionXIndex = ui_params.x_map;
  status.dimensionYIndex = ui_params.y_map;
  status.dimensionZIndex = ui_params.z_map;
  status.dimensionCIndex = ui_params.color_map;
  status.dimensionTIndex = ui_params.time_map;

  status.scaleX = ui_params.scale_x;
  status.scaleY = ui_params.scale_y;
  status.scaleZ = ui_params.scale_z;
  status.scaleR = ui_params.point_radius;
  status.scaleT = ui_params.time_slider;

  status.paletteIndex = ui_params.palette_index;
  status.maxColor = ui_params.palette_maxC;
  status.midColor = ui_params.palette_midC;
  status.minColor = ui_params.palette_minC;

  status.axisHelper = ui_params.axis_helper;
  status.gridHelper = ui_params.grid_helper;
  status.geoHelper = ui_params.geo_layer;

  status.cameraType = cameraType;
  status.cameraPosition = {x: camera.position.x, y: camera.position.y, z: camera.position.z};
  status.cameraRotation = {x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z};
  status.cameraUp = {x: camera.up.x, y: camera.up.y, z: camera.up.z};
  status.cameraSide = {l: camera.left, r: camera.right, t: camera.top, b: camera.bottom}; // for saving zoom in ortho camera
  status.control = {x: controls.target.x, y: controls.target.y, z: controls.target.z}; // for saving pan movements

  status.numberOfFrame = ui_params.frame_number;

  return status;
}

function logStatus() {

  $.ajax({
    url: '/logger', 
    type: 'POST', 
    contentType: 'application/json', 
    data: JSON.stringify(takeSnapshot())}
    ); 
}

function saveHistory(callback) {
  var ui_params = getUI_Params();

  if (ui_params.data_index === undefined || ui_params.data_index == -1) return;

  snapshotList = snapshotList || [];
  // if loading the history, don't take a snapshot anymore, it is already there
  if (callback === undefined) {
    snapshotList.push(takeSnapshot());
  }

  var currentHistory = $('#historyList').html();
  var snapshotID = "snapshotID" + (snapshotList.length-1);
  var lastElement = snapshotList[snapshotList.length-1];
  var snapshotDimensions = "<p align='left'>" +
                            "Data: " + datasets[lastElement.datasetIndex].name + "<br />" +
                            "X: " + ((lastElement.dimensionXIndex == -1) ? "none" : metaData.columnNames[lastElement.dimensionXIndex]) + "<br />" +
                            "Y: " + ((lastElement.dimensionYIndex == -1) ? "none" : metaData.columnNames[lastElement.dimensionYIndex]) + "<br />" +
                            "Z: " + ((lastElement.dimensionZIndex == -1) ? "none" : metaData.columnNames[lastElement.dimensionZIndex]) + "<br />" +
                            "Color: " + ((lastElement.dimensionCIndex == -1) ? "none" : metaData.columnNames[lastElement.dimensionCIndex]) + "<br />" +
                            "Time: " + ((lastElement.dimensionTIndex == -1) ? "none" : metaData.columnNames[lastElement.dimensionTIndex]) + "<br />" +
                            "</p>";

  currentHistory += '<div id="' + snapshotID + 'div"><img class="img-thumbnail" style="margin-left: 5px" width="160" height="80" id="' + snapshotID + '" onclick="loadHistory(' + (snapshotList.length-1) + ');" data-toggle="tooltip" title="' + snapshotDimensions + '"><button style="position:relative;right:20px;opacity:.8" type="button" onfocus="this.blur()" class="close" onclick="if (confirm(\'Are you sure you want to delete this bookmark?\')) $(\'#' + snapshotID + 'div\').remove()"><span>&times;</span></button><hr /></div>';
  $('#historyList').html(currentHistory);
  $('img').tooltip({'selector': '', 'placement': 'left', container: 'body', html: true});

  $('#' + snapshotID).attr('src', takeScreenshot());
  // keep scroller to the bottom
  $("#historyList")[0].scrollTop = $("#historyList")[0].scrollHeight;
  if (callback !== undefined) callback(null);
}

function takeScreenshot () {
  if (renderer)
    return renderer.domElement.toDataURL();
}

function loadHistoryThenBookmark(i, mainCallback) {
  async.series([
    function (callback) {
      loadHistory(i, callback);
    },
    function (callback) {
      // wait so the renderer can render the new view
      setTimeout(function() { callback(null); }, 5000);
    },
    function (callback) {
      saveHistory(callback);
    }
    ],
    function (err, results) { mainCallback(); });
}

function loadHistory(i, mainCallback) {
  var ui_params = getUI_Params();
  var snapshotListCopy;

  // check for data dimension consistency
  if (snapshotList[i].datasetIndex != ui_params.data_index) {
    async.series([
      function (callback) {
        // load data calls reset which clears snapshotList. so I'll keep a copy
        snapshotListCopy = snapshotList.slice();
        loadData(snapshotList[i].datasetIndex, callback);
      },
      function (callback) {
        snapshotList = snapshotListCopy.slice();
        loadHistoryAsync(i, callback);
      }
      ],
      function (err, results) { if (mainCallback !== undefined) mainCallback(); });
  } else {
    loadHistoryAsync(i, mainCallback);
  }
}

function loadHistoryAsync(i, callback) {
  var status = snapshotList[i];

  // redraw the picture based on saved parameters
  setMappingValues({data_index: null, x_map: status.dimensionXIndex, y_map: status.dimensionYIndex, z_map: status.dimensionZIndex, color_map: status.dimensionCIndex, time_map: status.dimensionTIndex});

  setColorValues({palette_index: status.paletteIndex, palette_minC: status.minColor, palette_midC: status.midColor, palette_maxC: status.maxColor});

  setSliderValues({scale_x: status.scaleX, scale_y: status.scaleY, scale_z: status.scaleZ, point_radius: status.scaleR, time_slider: status.scaleT});

  setTimeController({play_mode: false, frame_number: status.numberOfFrame});

  UI_Axis_Helper({axis_helper: status.axisHelper});
  UI_Grid_Helper({grid_helper: status.gridHelper});
  UI_Set_Geo({geo_layer: status.geoHelper});

  setCameraType(status.cameraType, status.cameraPosition, status.cameraRotation, status.cameraUp, status.cameraSide);
  setControls(status.control);

  if (callback !== undefined) callback(null);
}
