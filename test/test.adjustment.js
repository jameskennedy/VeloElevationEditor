var assert = require('assert')
  , adjustment = require('./../lib/adjustment');

suite('Elevation Adjustment Methods', function() {

  test('Test FixedBestFit Adjustment', function() {
    var data = {
        distance:        [ 1, 2, 3, 4, 5, 6, 7, 8],
        uploadElevation: [ 1, 1, 1, 1, 1, 1, 1, 1],
        googleElevation: [16,17,12,13, 6,11,14,15]};
        
    adjustment.do_adjustment(data);
    
    var expectedData = [];
    var offset = 7.5;
    for (var i = 0; i < data.distance.length; i++) {
        expectedData[i] = data.uploadElevation[i] + offset;
    }
    
    assertAdjustedElevation(expectedData, data);

  });

  test('Test Google Adjustment', function() {
    var data = {googleElevation: [1,2,3,4,5,6]};
    adjustment.do_adjustment(data, 'UseGoogle');
    
    assertAdjustedElevation(data.googleElevation, data);

  });
  
  test('Test FixedBestFitPartition Adjustment', function() {
    var maxElGainNoPartition = adjustment.REASONABLE_GRADE_THRESHOLD / 100 * 1000; /* km */
    var a = maxElGainNoPartition - 20;
    var b = maxElGainNoPartition + 1;
  
    var data = {
        distance:        [ 1, 2, 3, 4, 5, 6, 7, 8,  9, 10, 11, 12],
        uploadElevation: [ 1, 1, 1, a, 1, 1, 1, 1,  b,  b,  b,  b],
        googleElevation: [16,17,12,13, 6,11,14,15, 15, 15, 15, 15]};
        
    adjustment.do_adjustment(data, 'FixedBestFitPartition');
    
    var expectedData = [];
    var offset1 = 7.5;
    var offset2 = 15 - b;
    for (var i = 0; i < data.distance.length; i++) {
        expectedData[i] = data.uploadElevation[i] + (i < 8 ? offset1 : offset2);
    }
    
    assertAdjustedElevation(expectedData, data);
    
    // Same distance descrepancy handling
    data.adjustedElevation = null;
    data.distance[7] = data.distance[8];
    
    adjustment.do_adjustment(data, 'FixedBestFitPartition');
    assertAdjustedElevation(expectedData, data);

  });
  
  
});

function assertAdjustedElevation(expected, data) {
    assert.ok(data.adjustedElevation, 'Adjusted elevation not created');
    assert.equal(data.adjustedElevation.length, expected.length);
    for (var i = 0; i < data.adjustedElevation.length; i++) {
        assert.equal(data.adjustedElevation[i], expected[i], 
        'Mismatch at index ' + i + ': Expected ' + expected[i] + ' but got ' + data.adjustedElevation[i]);
    }
}
