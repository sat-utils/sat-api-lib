var _ = require('lodash');

var kinks = require('turf-kinks');
var gjv = require('geojson-validation');

var geojsonError = new Error('Invalid Geojson');

/**
 * checks if the polygon is valid, e.g. does not have self intersecting
 * points
 * @param  {object} feature the geojson feature
 * @return {boolean}         returns true if the polygon is valid otherwise false
 */
var validatePolygon = function (feature) {
  var ipoints = kinks(feature);

  if (ipoints.features.length > 0) {
    throw new Error('Invalid Polgyon: self-intersecting');
  }
};

var legacyParams = function (params) {
  return {
    query_string: {
      query: params.search
    }
  };
};

var termQuery = function (field, value) {
  var query = {
    match: {}
  };

  query.match[field] = {
    query: value,
    lenient: false,
    zero_terms_query: 'none'
  };

  return query;
};

var rangeQuery = function (field, frm, to) {
  var query = {
    range: {}
  };

  query.range[field] = {
    gte: frm,
    lte: to
  };

  return query;
};

var geoShaperQuery = function (field, geometry) {
  var _geometry = Object.assign({}, geometry);

  var query = {
    geo_shape: {}
  };

  if (_geometry.type === 'Polygon') {
    _geometry.type = _geometry.type.toLowerCase();
  }

  query.geo_shape[field] = {
    shape: _geometry
  };

  return query;
};

var contains = function (params) {
  var correctQuery = new RegExp('^[0-9\.\,\-]+$');
  if (correctQuery.test(params)) {
    var coordinates = params.split(',');
    coordinates = coordinates.map(parseFloat);

    if (coordinates[0] < -180 || coordinates[0] > 180) {
      throw new Error('Invalid coordinates');
    }

    if (coordinates[1] < -90 || coordinates[1] > 90) {
      throw new Error('Invalid coordinates');
    }

    return geoShaperQuery(
      'data_geometry',
      {
        type: 'circle',
        coordinates: coordinates,
        radius: '1km'
      }
    );
  } else {
    throw new Error('Invalid coordinates');
  }
};

var intersects = function (geojson, queries) {
  // if we receive an object, assume it's GeoJSON, if not, try and parse
  if (typeof geojson === 'string') {
    try {
      geojson = JSON.parse(geojson);
    } catch (e) {
      throw geojsonError;
    }
  }

  if (gjv.valid(geojson)) {
    if (geojson.type === 'FeatureCollection') {
      for (var i = 0; i < geojson.features.length; i++) {
        var feature = geojson.features[i];
        validatePolygon(feature);
        queries.push(geoShaperQuery('data_geometry', feature.geometry));
      }
    } else {
      if (geojson.type !== 'Feature') {
        geojson = {
          'type': 'Feature',
          'properties': {},
          'geometry': geojson
        };
      }
      validatePolygon(geojson);

      queries.push(geoShaperQuery('data_geometry', geojson.geometry));
    }
    return queries;
  } else {
    throw geojsonError;
  }
};

module.exports = function (params) {
  var response = {
    query: { match_all: {} },
    sort: [
      {date: {order: 'desc'}}
    ]
  };
  var queries = [];

  params = _.omit(params, ['limit', 'page', 'skip']);

  if (Object.keys(params).length === 0) {
    return response;
  }

  var rangeFields = {};

  var termFields = [
    {
      parameter: 'scene_id',
      field: 'scene_id'
    },
    {
      parameter: 'sensor',
      field: 'satellite_name'
    }
  ];

  // Do legacy search
  if (params.search) {
    response.query = legacyParams(params);
    return response;
  }

  // contain search
  if (params.contains) {
    queries.push(contains(params.contains));
    params = _.omit(params, ['contains']);
  }

  // intersects search
  if (params.intersects) {
    queries = intersects(params.intersects, queries);
    params = _.omit(params, ['intersects']);
  }

  // select parameters that have _from or _to
  _.forEach(params, function (value, key) {
    var field = key.replace('_from', '');
    field = field.replace('_to', '');

    if (key === 'cloud_from' || key === 'cloud_to') {
      rangeFields['cloud'] = {
        from: 'cloud_from',
        to: 'cloud_to',
        field: 'cloud_coverage'
      };
    } else if (_.endsWith(key, '_from')) {
      if (_.isUndefined(rangeFields[field])) {
        rangeFields[field] = {};
      }

      rangeFields[field]['from'] = key;
      rangeFields[field]['field'] = field;
    } else if (_.endsWith(key, '_to')) {
      if (_.isUndefined(rangeFields[field])) {
        rangeFields[field] = {};
      }

      rangeFields[field]['to'] = key;
      rangeFields[field]['field'] = field;
    } else {
      return;
    }
  });

  // Range search
  _.forEach(rangeFields, function (value, key) {
    queries.push(
      rangeQuery(
        value.field,
        _.get(params, _.get(value, 'from')),
        _.get(params, _.get(value, 'to'))
      )
    );
    params = _.omit(params, [_.get(value, 'from'), _.get(value, 'to')]);
  });

  // Term search
  for (var i = 0; i < termFields.length; i++) {
    if (_.has(params, termFields[i].parameter)) {
      queries.push(
        termQuery(
          termFields[i].field,
          params[termFields[i].parameter]
        )
      );
    }
  }

  // For all items that were not matched pass the key to the term query
  _.forEach(params, function (value, key) {
    queries.push(termQuery(key, value));
  });

  response.query = {
    bool: {
      must: queries
    }
  };

  return response;
};
