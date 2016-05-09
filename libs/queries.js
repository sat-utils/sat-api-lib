'use strict';

var _ = require('lodash');
var ejs = require('elastic.js');
var gjv = require('geojson-validation');

/**
 * @apiDefine search
 * @apiParam {string} [search] Supports Lucene search syntax for all available fields
 * in the landsat meta data. <br> If search is used, all other parameters are ignored.
**/
var legacyParams = function (params, q) {
  q.query(ejs.QueryStringQuery(params.search));
  return q;
};

var geojsonQueryBuilder = function (feature, query) {
  var shape = ejs.Shape(feature.geometry.type, feature.geometry.coordinates);
  query = query.should(ejs.GeoShapeQuery()
                          .field('data_geometry')
                          .shape(shape));
  return query;
};

/**
 * @apiDefine contains
 * @apiParam {string} [contains] Evaluates whether the given point is within the
 * bounding box of a landsat image.
 *
 * Accepts `latitude` and `longitude`. They have to be separated by a `,`
 * with no spaces in between. Example: `contains=23,21`
**/
var contains = function (params, query) {
  var correct_query = new RegExp('^[0-9\.\,\-]+$');
  if (correct_query.test(params)) {
    var coordinates = params.split(',');
    coordinates = coordinates.map(parseFloat);

    if (coordinates[0] < -180 || coordinates[0] > 180) {
      return err.incorrectCoordinatesError(params);
    }

    if (coordinates[1] < -90 || coordinates[1] > 90) {
      return err.incorrectCoordinatesError(params);
    }

    var shape = ejs.Shape('circle', coordinates).radius('1km');

    query = query.must(ejs.GeoShapeQuery()
                            .field('data_geometry')
                            .shape(shape));
    return query;
  } else {
    err.incorrectCoordinatesError(params);
  }
};

/**
 * @apiDefine intersects
 * @apiParam {string/geojson} [intersects] Evaluates whether the give geojson is intersects
 * with any landsat images.
 *
 * Accepts valid geojson.
**/
var intersects = function (geojson, query) {
  // if we receive an object, assume it's GeoJSON, if not, try and parse
  if (gjv.valid(geojson)) {
    // If it is smaller than Nigeria use geohash
    // if (tools.areaNotLarge(geojson)) {
    if (geojson.type === 'FeatureCollection') {
      for (var i=0; i < geojson.features.length; i++) {
        var feature = geojson.features[i];
        query = geojsonQueryBuilder(feature, query);
      }
    } else {
      query = geojsonQueryBuilder(geojson, query);
    }
    return query;
  } else {
    err.invalidGeoJsonError();
  }
};

var rangeQuery = function (from, to, field, query) {
  if (!_.isUndefined(from) && _.isString(from)) {
    from = _.toLower(from);
  }

  if (!_.isUndefined(to) && _.isString(to)) {
    to = _.toLower(to);
  }

  if (!_.isUndefined(from) && !_.isUndefined(to)) {
    return query.must(ejs.RangeQuery(field).gte(from).lte(to));
  }

  if (!_.isUndefined(from)) {
    return query.must(ejs.RangeQuery(field).gte(from));
  }

  if (!_.isUndefined(to)) {
    return query.must(ejs.RangeQuery(field).lte(to));
  }
};

var matchQuery = function (field, param, query) {
  return query.must(ejs.MatchQuery(field, param)
                       .lenient(false)
                       .zeroTermsQuery('none'));
};

module.exports = function (params, q) {
  var query = ejs.BoolQuery();

  params = _.omit(params, ['limit', 'page', 'skip']);

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
    return legacyParams(params, q);
  };

  // contain search
  if (params.contains) {
    query = contains(params.contains, query);
    params = _.omit(params, ['contains']);
  }

  // intersects search
  if (params.intersects) {
    query = intersects(params.intersects, query);
    params = _.omit(params, ['intersects']);
  }

  // select parameters that have _from or _to
  _.forEach(params, function(value, key) {
    var field = _.replace(key, '_from', '');
    field = _.replace(field, '_to', '');

    if (key === 'cloud_from' || key === 'cloud_to') {
      rangeFields['cloud'] = {
        from: 'cloud_from',
        to: 'cloud_to',
        field: 'cloud_coverage'
      };
    }
    else if (_.endsWith(key, '_from')) {
      if (_.isUndefined(rangeFields[field])) {
        rangeFields[field] = {};
      }

      rangeFields[field]['from'] = key;
      rangeFields[field]['field'] = field;
    } else if ( _.endsWith(key, '_to')) {
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
  _.forEach(rangeFields, function(value, key) {
    query = rangeQuery(
      _.get(params, _.get(value, 'from')),
      _.get(params, _.get(value, 'to')),
      value['field'],
      query
    );
    params = _.omit(params, [_.get(value, 'from'), _.get(value, 'to')]);
  });

  // Term search
  for (var i = 0; i < termFields.length; i++) {
    if (_.has(params, termFields[i].parameter)) {
      query = matchQuery(termFields[i].field, params[termFields[i].parameter], query);
      params = _.omit(params, [termFields[i].parameter]);
    }
  }

  // For all items that were not matched pass the key to the term query
  _.forEach(params, function(value, key) {
    query = matchQuery(key, value, query);
  });

  return q.query(query);
};
