'use strict';

var _ = require('lodash');
var ejs = require('elastic.js');
var area = require('turf-area');
var intersect = require('turf-intersect');
var elasticsearch = require('elasticsearch');

var logger = require('./logger');
var queries = require('./queries.js');

var client = new elasticsearch.Client({
  host: process.env.ES_HOST || 'localhost:9200',

  // Note that this doesn't abort the query.
  requestTimeout: 50000  // milliseconds
});

// converts string intersect to js object
var intersectsToObj = function (intersects) {
  if (_.isString(intersects)) {
    try {
      intersects = JSON.parse(intersects);
    } catch (e) {
      throw new Error('Invalid Geojson');
    }
  }

  return intersects;
};

var Search = function (event) {
  var params;

  logger.debug('received event:', event);

  if (_.has(event, 'query') && !_.isEmpty(event.query)) {
    params = event.query;
  } else if (_.has(event, 'body') && !_.isEmpty(event.body)) {
    params = event.body;
  } else {
    params = {};
  }

  this.aoiCoverage = null;

  if (_.has(params, 'aoi_coverage_percentage')) {
    this.aoiCoverage = params['aoi_coverage_percentage'];
    params = _.omit(params, ['aoi_coverage_percentage']);
  }

  // get page number
  var page = parseInt((params.page) ? params.page : 1);

  // Build Elastic Search Query
  this.q = ejs.Request();

  // set size, frm, params and page

  this.params = params;
  logger.debug('Generated params:', params);

  this.size = parseInt((params.limit) ? params.limit : 1);
  this.frm = (page - 1) * this.size;
  this.page = parseInt((params.skip) ? params.skip : page);
};

var aoiCoveragePercentage = function (feature, scene, aoiArea) {
  var intersectObj = intersect(feature, scene);
  if (intersectObj === undefined) {
    return 0;
  }

  var intersectArea = area(intersectObj);
  var percentage = (intersectArea / aoiArea) * 100;

  return percentage;
};

Search.prototype.calculateAoiCoverage = function (response) {
  var self = this;
  if (this.aoiCoverage && _.has(this.params, 'intersects')) {
    this.params.intersects = intersectsToObj(this.params.intersects);
    var coverage = parseFloat(this.aoiCoverage);
    var newResponse = [];
    var aoiArea = area(self.params.intersects);

    response.forEach(function (r) {
      var gj = self.params.intersects;
      var percentage = 0;

      if (gj.type === 'FeatureCollection') {
        gj.features.forEach(function (f) {
          percentage += aoiCoveragePercentage(f.geometry, r.data_geometry, aoiArea);
        });
      } else if (gj.type === 'Feature') {
        percentage = aoiCoveragePercentage(gj.geometry, r.data_geometry, aoiArea);
      } else if (gj.type === 'Polygon') {
        percentage = aoiCoveragePercentage(gj, r.data_geometry, aoiArea);
      }

      if (percentage >= coverage) {
        newResponse.push(r);
      }
    });

    return newResponse;
  } else {
    return response;
  }
};

Search.prototype.buildSearch = function () {
  var fields;

  // if fields are included remove it from params
  if (_.has(this.params, 'fields')) {
    fields = this.params.fields;
    this.params = _.omit(this.params, ['fields']);
  }

  if (Object.keys(this.params).length > 0) {
    this.q = queries(this.params, this.q);
  } else {
    this.q.query(ejs.MatchAllQuery());
  }

  if (this.q) {
    this.q = this.q.sort('date', 'desc');
  }

  return {
    index: process.env.ES_INDEX || 'sat-api',
    body: this.q,
    size: this.size,
    from: this.frm,
    _source: fields
  };
};

Search.prototype.buildAggregation = function () {
  var self = this;

  var dateHistogram = function (name) {
    return ejs.DateHistogramAggregation(name + '_histogram').format('YYYY-MM-DD').interval('day');
  };
  var termsAggregation = function (name) {
    return ejs.TermsAggregation('terms_' + name);
  };

  var aggr = {
    date: dateHistogram,
    satellite_name: termsAggregation,
    latitude_band: termsAggregation,
    utm_zone: termsAggregation,
    product_path: termsAggregation,
    grid_square: termsAggregation,
    sensing_orbit_number: termsAggregation,
    sensing_orbit_direction: termsAggregation
  };

  if (_.has(this.params, 'fields')) {
    var fields = this.params.fields.split(',');

    _.forEach(fields, function (field) {
      if (_.has(aggr, field)) {
        self.q.agg(aggr[field](field).field(field));
      }
    });

    this.params = _.omit(this.params, ['fields']);
  }

  if (Object.keys(this.params).length > 0) {
    this.q = queries(this.params, this.q);
  } else {
    this.q.query(ejs.MatchAllQuery());
  }

  return {
    index: process.env.ES_INDEX || 'sat-api',
    body: this.q,
    size: 0
  };
};

Search.prototype.legacy = function (callback) {
  var self = this;

  // Add landsat to the search parameter
  var sat = 'satellite_name:landsat';
  if (self.params.search && self.params.search.length > 0) {
    self.params.search = self.params.search + ' AND ' + sat;
  } else {
    self.params.search = sat;
  }

  try {
    var searchParams = this.buildSearch();
  } catch (e) {
    return callback(e, null);
  }

  // limit search to only landsat
  client.search(searchParams).then(function (body) {
    var response = [];
    var count = 0;

    count = body.hits.total;
    for (var i = 0; i < body.hits.hits.length; i++) {
      response.push(body.hits.hits[i]._source);
    }

    var r = {
      meta: {
        author: process.env.NAME || 'Development Seed',
        results: {
          skip: self.frm,
          limit: self.size,
          total: count
        }
      },
      results: response
    };

    return callback(null, r);
  }, function (err) {
    logger.error(err);
    return callback(err);
  });
};

Search.prototype.simple = function (callback) {
  var self = this;
  var searchParams;

  try {
    searchParams = this.buildSearch();
  } catch (e) {
    return callback(e, null);
  }

  client.search(searchParams).then(function (body) {
    var response = [];
    var count = 0;

    count = body.hits.total;
    for (var i = 0; i < body.hits.hits.length; i++) {
      response.push(body.hits.hits[i]._source);
    }

    response = self.calculateAoiCoverage(response);

    // this is needed for cases where calculateAoiCoverage has returned a smaller value
    if (response.length < self.size) {
      count = response.length;
    }

    var r = {
      meta: {
        found: count,
        name: process.env.NAME || 'sat-api',
        license: 'CC0-1.0',
        website: process.env.WEBSITE || 'https://api.developmentseed.org/satellites/',
        page: self.page,
        limit: self.size
      },
      results: response
    };

    return callback(null, r);
  }, function (err) {
    logger.error(err);
    return callback(err);
  });
};

Search.prototype.geojson = function (callback) {
  var self = this;
  var searchParams;

  try {
    searchParams = this.buildSearch();
  } catch (e) {
    return callback(e, null);
  }

  client.search(searchParams).then(function (body) {
    var count = body.hits.total;

    var response = {
      type: 'FeatureCollection',
      properties: {
        found: count,
        limit: self.size,
        page: self.page
      },
      features: []
    };

    for (var i = 0; i < body.hits.hits.length; i++) {
      response.features.push({
        type: 'Feature',
        properties: {
          scene_id: body.hits.hits[i]._source.scene_id,
          satellites_name: body.hits.hits[i]._source.satellites_name,
          cloud_coverage: body.hits.hits[i]._source.cloud_coverage,
          date: body.hits.hits[i]._source.date,
          thumbnail: body.hits.hits[i]._source.thumbnail
        },
        geometry: body.hits.hits[i]._source.data_geometry
      });
    }

    return callback(null, response);
  }, function (err) {
    logger.error(err);
    return callback(err);
  });
};

Search.prototype.count = function (callback) {
  var searchParams;

  try {
    searchParams = this.buildAggregation();
  } catch (e) {
    return callback(e, null);
  }

  client.search(searchParams).then(function (body) {
    var count = 0;

    count = body.hits.total;

    var r = {
      meta: {
        found: count,
        name: process.env.NAME || 'sat-api',
        license: 'CC0-1.0',
        website: process.env.WEBSITE || 'https://api.developmentseed.org/satellites/'
      },
      counts: body.aggregations
    };

    return callback(null, r);
  }, function (err) {
    logger.error(err);
    return callback(err);
  });
};

module.exports = Search;
