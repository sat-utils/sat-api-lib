'use strict';
process.env.ES_HOST = 'localhost:9200';

var nock = require('nock');
var test = require('tap').test;
var Search = require('../index.js');
var payload = require('./events/count.json');


nock.back.fixtures = __dirname + '/fixtures';
nock.back.setMode('record');

var nockBack = function(key, func) {
  nock.back('count-' + key + '.json', function(nockDone) {
    var search = new Search(payload[key]);
    search.count(function (err, response) {
      nockDone();
      func(err, response);
    });
  });
};


test('count endpoint with simple GET/POST should return 1 result', function (t) {
  var keys = ['simpleGet', 'simplePost', 'simplePostLimit2'];
  keys.forEach(function(key, index) {
    nockBack(key, function(err, response) {
      t.equals(response.meta.found, 987449);
      if (index === keys.length - 1) {
        t.end();
      }
    });
  });
});

test('count endpoint POST intersects', function (t) {
  var key = 'postIntersects';
  nockBack(key, function(err, response) {
    t.equals(response.meta.found, 237);
    t.end();
  });
});

test('count endpoint GET intersects with no match', function (t) {
  var key = 'getIntersects';
  nockBack(key, function(err, response) {
    t.equals(response.meta.found, 0);
    t.end();
  });
});

test('count endpoint GET with fields', function (t) {
  var key = 'getFields';
  nockBack(key, function(err, response) {
    t.equals(response.meta.found, 987449);
    t.equals(response.counts.terms_latitude_band.sum_other_doc_count, 69738);
    t.equals(response.counts.terms_satellite_name.buckets[0].doc_count, 709937);
    t.end();
  });
});

