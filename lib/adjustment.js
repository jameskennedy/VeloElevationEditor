var sys = require("sys");

var adjustment = module.exports = {
    UPLOAD_DIR: 'uploads',
    
    do_adjustment:   function(data, adjust_mode) {
	    // Default
	    if (!adjust_mode) {
	        adjust_mode = 'FixedBestFit';
	    }
	    
	    if (adjust_mode == 'UseGoogle') {
	        data.adjustedElevation = data.googleElevation;
	    } else if (adjust_mode == 'FixedBestFit') {
	        this.fixedShiftAdjustment(data, 0, data.latitude.length - 1);
	    } else if (adjust_mode == 'FixedBestFitPartition') {
	        this.fixedShiftPartitionedAdjustment(data);
	    } else {	       
	        return false;
	    }
	    
	    return true;
	},
	
	fixedShiftPartitionedAdjustment:   function(data) {
	    var start = 0;
	    var end = 0;
	    
	    var lastDistance = data.distance[0];
	    var lastElevation = data.uploadElevation[0];
	    var samePointStart = null;
	    
	    for (end = 1; end < data.uploadElevation.length; end++) {
	        var distance = data.distance[end];
	        var elevation = data.uploadElevation[end];
	        
	        var distanceDelta = (distance - lastDistance) * 1000; //km > m
	        var elevationDelta = elevation - lastElevation;
	        
	        lastDistance = distance;
	        lastElevation = elevation;
	        
	        if (!distanceDelta) {    
	            
	            if (Math.abs(elevationDelta) < 5) {
	                continue;
	            }
	            
	                    
	            if (!samePointStart) {
	                samePointStart = end;
	                sys.debug("Same point elevation discrepancy of " + elevationDelta + "m at " + distance + "km, partitioning");
	                this.fixedShiftAdjustment(data, start, end - 1);
	                start = end;
	            }
	
	        } else {      
	            //TODO: This is supposing that distance has been recorded via bike sensor and not GPS  
	            var horizDistance = Math.sqrt(Math.pow(distanceDelta,2) - Math.pow(elevationDelta,2));
	            var grade = 100 * elevationDelta / horizDistance;
	            if (grade > 40 || grade < -60) {
	                sys.debug("Suspicious grade of " + grade + " at " + distance + "km, v. delta " + elevationDelta +"m, h. delta " + distanceDelta + ", partitioning");
	                this.fixedShiftAdjustment(data, start, end - 1);
	                start = end;
	            }
	            
	            samePointStart = null;
	        }
	    }
	    
	    fixedShiftAdjustment(data, start, data.uploadElevation.length - 1);
	},
	
	fixedShiftAdjustment:  function(data, start, end, bias) {
	    if (start > end) {
	      return;
	    }
	
	    // Initialize adjustment data
	    if (!data.adjustedElevation) {
	        data.adjustedElevation = [];
	        data.elevationDelta = [];
	        for (var i = 0; i < start; i++) {
	            data.adjustedElevation[i] = data.uploadElevation[i];
	            data.elevationDelta[i] = 0;
	        }
	        for (var i = end + 1; i < data.uploadElevation.length; i++) {
	            data.adjustedElevation[i] = data.uploadElevation[i];
	            data.elevationDelta[i] = 0;
	        }
	    }
	    
	    var maxDeltaIndex = 0;
	    var inclusionGroup = [];
	    var maxInclusion = Math.max(1, Math.round((end - start) * 0.25));
	    for (var i = start; i <= end; i++) {
	        var inclusionIndex = i - start;
	        var delta = data.googleElevation[i] - data.uploadElevation[i];
	        data.elevationDelta[i] = delta;
	        
	        if (inclusionIndex < maxInclusion) {
	            inclusionGroup.push(delta);
	            if (Math.abs(delta) > Math.abs(inclusionGroup[maxDeltaIndex])) {
	                maxDeltaIndex = inclusionIndex;
	            }
	            
	        } else {
	            if (Math.abs(delta) < Math.abs(inclusionGroup[maxDeltaIndex])) {
	                inclusionGroup[maxDeltaIndex] = delta;
	                for (var j = 0; j < maxInclusion; j++) {
	                    if (Math.abs(inclusionGroup[j]) > Math.abs(inclusionGroup[maxDeltaIndex])) {
	                        maxDeltaIndex = j;
	                    }
	                }
	            }
	        }
	    }
	    
	    // sys.debug(util.inspect(inclusionGroup));
	    
	    var cummulativeDelta = 0;
	    for (var i = 0; i < maxInclusion; i++) {
	        cummulativeDelta += inclusionGroup[i];
	    } 
	
	    var fixedAdjustment = cummulativeDelta / maxInclusion;
	    if (bias) {
	        fixedAdjustment += bias;
	    }
	    
	    sys.debug("Fixed adjustment: From " + start + ":" +  data.distance[start] + " to " + end + ":" + data.distance[end] + " shifted " + fixedAdjustment + "m using " + maxInclusion + " min delta points");
	    for (var i = start; i <= end; i++) {
	        data.adjustedElevation[i] = data.uploadElevation[i] + fixedAdjustment;
	    } 
	}
}