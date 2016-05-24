'use strict';
process.env.ES_HOST = 'localhost:9200';

var _ = require('lodash');
var path = require('path');
var nock = require('nock');
var test = require('tap').test;
var Search = require('../index.js');
var payload = require('./events/simple.json');

nock.back.fixtures = path.join(__dirname + '/fixtures');
nock.back.setMode('record');

var nockBack = function (key, func) {
  nock.back('simple-' + key + '.json', function (nockDone) {
    var search = new Search(payload[key]);
    search.simple(function (err, response) {
      nockDone();
      func(err, response);
    });
  });
};

test('root endpoint with simple GET/POST should return 1 result', function (t) {
  var keys = ['simpleGet', 'simplePost'];
  keys.forEach(function (key, index) {
    nockBack(key, function (err, response) {
      t.error(err);
      t.equals(response.meta.limit, 1);
      t.equals(response.results.length, 1);
      t.ok(_.has(response.results[0], 'scene_id'));
      if (index === keys.length - 1) {
        t.end();
      }
    });
  });
});

test('root endpoint with simple GET/POST should return 1 result', function (t) {
  var keys = ['simplePostLimit2WithFields'];
  keys.forEach(function (key) {
    nockBack(key, function (err, response) {
      t.error(err);
      t.equals(response.meta.limit, 2);
      t.equals(response.results.length, 2);
      t.notOk(_.has(response.results[0], 'scene_id'));
      t.ok(_.has(response.results[0], 'date'));
      t.ok(_.has(response.results[0], 'thumbnail'));
      t.end();
    });
  });
});

test('root endpoint with simple POST with limit 2 should return 2 result', function (t) {
  var key = 'simplePostLimit2';
  nockBack(key, function (err, response) {
    t.error(err);
    t.equals(response.meta.limit, 2);
    t.equals(response.results.length, 2);
    t.end();
  });
});

test('root endpoint with POST date range', function (t) {
  var key = 'postDatRange';
  nockBack(key, function (err, response) {
    t.error(err);
    t.equals(response.meta.found, 454226);
    t.equals(response.meta.limit, 1);
    t.equals(response.results.length, 1);
    t.end();
  });
});

test('root endpoint POST intersects', function (t) {
  var key = 'postIntersects';
  nockBack(key, function (err, response) {
    t.error(err);
    t.equals(response.meta.found, 237);
    t.equals(response.meta.limit, 1);
    t.equals(response.results.length, 1);
    t.end();
  });
});

test('root endpoint GET intersects with no match', function (t) {
  var key = 'getIntersects';
  nockBack(key, function (err, response) {
    t.error(err);
    t.equals(response.meta.found, 0);
    t.equals(response.meta.limit, 1);
    t.equals(response.results.length, 0);
    t.end();
  });
});

test('root endpoint GET invalid intersect', function (t) {
  var key = 'getIntersectsInvalid';
  nockBack(key, function (err, response) {
    t.match(err, Error);
    t.match(err.message, 'Invalid Geojson');
    t.end();
  });
});

test('root endpoint GET string intersects', function (t) {
  var key = 'getIntersectsString';
  nockBack(key, function (err, response) {
    t.error(err);
    t.equals(response.meta.found, 0);
    t.equals(response.meta.limit, 1);
    t.equals(response.results.length, 0);
    t.end();
  });
});

test('root endpoint GET string intersects with satelline_name', function (t) {
  var key = 'getIntersectsWithSatellineName';
  nockBack(key, function (err, response) {
    t.error(err);
    t.equals(response.meta.found, 53);
    t.equals(response.meta.limit, 1);
    t.equals(response.results.length, 1);
    t.end();
  });
});
