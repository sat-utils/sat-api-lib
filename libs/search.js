'use strict';

var _ = require('lodash');
var moment = require('moment');
var area = require('turf-area');
var intersect = require('turf-intersect');
var elasticsearch = require('elasticsearch');

var logger = require('./logger');
var queries = require('./queries');
var aggregations = require('./aggregations');

var esConfig = {
  host: process.env.ES_HOST || 'localhost:9200',

  // Note that this doesn't abort the query.
  requestTimeout: 50000  // milliseconds
}

// use AWS Sing4 if aws-access-key is provided
if (_.has(process.env, 'AWS_ACCESS_KEY_ID') && _.has(process.env, 'AWS_SECRET_ACCESS_KEY')) {
  esConfig.connectionClass = require('http-aws-es');
  esConfig.amazonES = {
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY
  }
}


var client = new elasticsearch.Client(esConfig);

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

var Search = function (event, customClient) {
  var params;

  console.log('received query:', event.query);
  console.log('received body:', event.body);

  if (_.has(event, 'query') && !_.isEmpty(event.query)) {
    params = event.query;
  } else if (_.has(event, 'body') && !_.isEmpty(event.body)) {
    params = event.body;
  } else {
    params = {};
  }

  if (_.has(params, 'cloudCoverFull')) {
    params.cloud_coverage = params['cloudCoverFull']
    params = _.omit(params, ['cloudCoverFull'])
    console.log(`HASCLOUDCOVERFULL ${params}`)
  }

  this.aoiCoverage = null;

  if (_.has(params, 'aoi_coverage_percentage')) {
    this.aoiCoverage = params['aoi_coverage_percentage'];
    params = _.omit(params, ['aoi_coverage_percentage']);
  }

  // get page number
  var page = parseInt((params.page) ? params.page : 1);

  this.params = params;

  this.size = parseInt((params.limit) ? params.limit : 1);
  this.frm = (page - 1) * this.size;
  this.page = parseInt((params.skip) ? params.skip : page);

  this.client = customClient || client;
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

  if (this.satelliteName) {
    this.params.satellite_name = this.satelliteName;
  }

  return {
    index: process.env.ES_INDEX || 'sat-api',
    body: queries(this.params),
    size: this.size,
    from: this.frm,
    _source: fields
  };
};

Search.prototype.buildAggregation = function () {
  var aggrs = {aggs: {}};

  if (_.has(this.params, 'fields')) {
    var fields = this.params.fields.split(',');

    _.forEach(fields, function (field) {
      if (field === 'date') {
        aggrs.aggs = _.assign(aggrs.aggs, aggregations.date(field));
      } else {
        aggrs.aggs = _.assign(aggrs.aggs, aggregations.term(field));
      }
    });

    this.params = _.omit(this.params, ['fields']);
  }

  return {
    index: process.env.ES_INDEX || 'sat-api',
    body: _.assign({}, aggrs, queries(this.params)),
    size: 0
  };
};

Search.prototype.buildHealthAggregation = function () {
  // only aggregate by date field
  var aggrs = {
    aggs: aggregations.date('date')
  };

  return {
    index: process.env.ES_INDEX || 'sat-api',
    body: _.assign({}, aggrs, queries(this.params)),
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
  this.client.search(searchParams).then(function (body) {
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

Search.prototype.landsat = function (callback) {
  this.satelliteName = 'landsat';
  return this.simple(callback);
};

Search.prototype.sentinel = function (callback) {
  this.satelliteName = 'sentinel';
  return this.simple(callback);
};

Search.prototype.simple = function (callback) {
  var self = this;
  var searchParams;

  try {
    searchParams = this.buildSearch();
  } catch (e) {
    return callback(e, null);
  }

  logger.debug(JSON.stringify(searchParams));

  this.client.search(searchParams).then(function (body) {
    var response = [];
    var count = 0;

    count = body.hits.total;
    for (var i = 0; i < body.hits.hits.length; i++) {
      var record = body.hits.hits[i]._source
      record.cloudCoverFull = record.cloud_coverage
      response.push(record)
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

  this.client.search(searchParams).then(function (body) {
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

  this.client.search(searchParams).then(function (body) {
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

Search.prototype.health = function (callback) {
  var self = this;
  var searchParams;

  try {
    searchParams = this.buildHealthAggregation();
  } catch (e) {
    return callback(e, null);
  }

  this.client.search(searchParams).then(function (body) {
    var limit = 3000;
    var count = 0;

    var missingScenes = [];
    var missingDates = [];

    if (_.get(self.params, 'satellite_name', null) === 'sentinel') {
      limit = 2000;
    }

    var start = moment('2015-10-01');
    var end = moment();
    var dates = [];

    while (start <= end) {
      dates.push(start.format('YYYY-MM-DD'));
      start.add(1, 'day');
    }

    // iterate through all dates
    body.aggregations.scenes_by_date.buckets.map(b => {
      dates.push(b.key_as_string);

      if (b.doc_count < limit) {
        missingScenes.push({
          date: b.key_as_string,
          probably_missing: limit - b.doc_count
        });
      }
    });

    while (start <= end) {
      if (dates.indexOf(start.format('YYYY-MM-DD')) === -1) {
        missingDates.push(start.format('YYYY-MM-DD'));
      }
      start.add(1, 'day');
    }

    count = body.hits.total;

    var r = {
      meta: {
        total_dates: body.aggregations.scenes_by_date.buckets.length,
        dates_with_missing_scenes: missingScenes.length,
        percentage: missingScenes.length / body.aggregations.scenes_by_date.buckets.length * 100,
        name: process.env.NAME || 'sat-api',
        license: 'CC0-1.0',
        website: process.env.WEBSITE || 'https://api.developmentseed.org/satellites/'
      },
      missing_scenes: missingScenes,
      missing_dates: missingDates
    };

    return callback(null, r);
  }, function (err) {
    logger.error(err);
    return callback(err);
  });
};

module.exports = Search;
