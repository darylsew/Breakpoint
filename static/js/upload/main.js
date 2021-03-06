/* Copyright 2013 Chris Wilson

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

window.AudioContext = window.AudioContext || window.webkitAudioContext;

var audioContext = new AudioContext();
var audioInput = null,
    realAudioInput = null,
    inputPoint = null,
    audioRecorder = null;
var rafID = null;
var analyserContext = null;
var canvasWidth, canvasHeight;
var recIndex = 0;
var started = false;
var volumes = [];
var centroids = [];
var latitude;
var longitude;

/* TODO:

- offer mono option
- "Monitor input" switch
*/

function saveAudio() {
    audioRecorder.exportWAV( doneEncoding );
    // could get mono instead by saying
    // audioRecorder.exportMonoWAV( doneEncoding );
}

function gotBuffers( buffers ) {
    //var canvas = document.getElementById( "wavedisplay" );

    //drawBuffer( canvas.width, canvas.height, canvas.getContext('2d'), buffers[0] );

    // the ONLY time gotBuffers is called is right after a new recording is completed - 
    // so here's where we should set up the download.
    audioRecorder.exportWAV( doneEncoding );
}

function doneEncoding( blob ) {
    Recorder.setupDownload( blob, "myRecording" + ((recIndex<10)?"0":"") + recIndex + ".wav" );
    recIndex++;
}

function toggleRecording() {
    //if (e.classList.contains("recording")) {
    if (started) {
        // stop recording (this is where we upload all the things!)
        audioRecorder.stop();
        started = false;
        audioRecorder.exportWAV(doneEncoding);
        console.log("Stopped recording.");
        clearInterval(handle);
        // slice off leading NaN and 0 values from sound data
        for (var i=0;i<centroids.length;i++) {
            if (!isNaN(centroids[i])) {
                //console.log("I think this is a number: " + centroids[i]);
                centroids = centroids.slice(i, centroids.length);
                console.log(centroids);
                volumes = volumes.slice(i, volumes.length);
                break;
            }
        }
        var biteData = {
            "volumes": volumes,
            "centroids": centroids,
            "latitude": latitude,
            "longitude": longitude,
            "token": USER_TOKEN
        };
        $.ajax({
            type: "POST",
            url: "/upload",
            data: JSON.stringify(biteData),
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            success: function(data){
                console.log("successfully sent audio data");
                console.log(data);
                window.location.href = '/map';
            },
            failure: function(err){
                console.log("failed to send data");
                console.log(err);
            }
        });
    } else {
        // start recording
        if (!audioRecorder)
            return;
        started = true;
        audioRecorder.clear();
        console.log("Started recording.");
        audioRecorder.record();
        handle = setInterval(analyze, 20);
    }
}

function analyze() {
    var freqByteData = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(freqByteData); 
    // convert typed array to normal array
    freqByteData = Array.apply( [], freqByteData);
    //console.log(freqByteData);
    var volume = freqByteData.reduce(function(a, b) {
        return a + b;
    });
    volumes[volumes.length] = volume;
    console.log("volume: " + volume);

    var factor = 20000.0/freqByteData.length;
    var centroid = freqByteData.reduce(function(p, c, i, a) {
        return p + c*i*factor;
    });
    centroids[centroids.length] = centroid / volume;
    console.log("centroid: " + centroids[centroids.length-1]);
}

function convertToMono( input ) {
    var splitter = audioContext.createChannelSplitter(2);
    var merger = audioContext.createChannelMerger(2);

    input.connect( splitter );
    splitter.connect( merger, 0, 0 );
    splitter.connect( merger, 0, 1 );
    return merger;
}

function cancelAnalyserUpdates() {
    window.cancelAnimationFrame( rafID );
    rafID = null;
}

function updateAnalysers(time) {
    if (!analyserContext) {
        var canvas = document.getElementById("analyser");
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
        analyserContext = canvas.getContext('2d');
    }

    // analyzer draw code here
    {
        var SPACING = 3;
        var BAR_WIDTH = 1;
        var numBars = Math.round(canvasWidth / SPACING);
        var freqByteData = new Uint8Array(analyserNode.frequencyBinCount);

        analyserNode.getByteFrequencyData(freqByteData); 

        analyserContext.clearRect(0, 0, canvasWidth, canvasHeight);
        analyserContext.fillStyle = '#F6D565';
        analyserContext.lineCap = 'round';
        var multiplier = analyserNode.frequencyBinCount / numBars;

        // Draw rectangle for each frequency bin.
        for (var i = 0; i < numBars; ++i) {
            var magnitude = 0;
            var offset = Math.floor( i * multiplier );
            // gotta sum/average the block, or we miss narrow-bandwidth spikes
            for (var j = 0; j< multiplier; j++)
                magnitude += freqByteData[offset + j];
            magnitude = magnitude / multiplier;
            var magnitude2 = freqByteData[i * multiplier];
            analyserContext.fillStyle = "hsl( " + Math.round((i*360)/numBars) + ", 100%, 50%)";
            analyserContext.fillRect(i * SPACING, canvasHeight, BAR_WIDTH, -magnitude);
        }
    }
    
    rafID = window.requestAnimationFrame( updateAnalysers );
}

function toggleMono() {
    if (audioInput != realAudioInput) {
        audioInput.disconnect();
        realAudioInput.disconnect();
        audioInput = realAudioInput;
    } else {
        realAudioInput.disconnect();
        audioInput = convertToMono( realAudioInput );
    }

    audioInput.connect(inputPoint);
}

function gotStream(stream) {
    inputPoint = audioContext.createGain();

    // Create an AudioNode from the stream.
    realAudioInput = audioContext.createMediaStreamSource(stream);
    audioInput = realAudioInput;
    audioInput.connect(inputPoint);

//    audioInput = convertToMono( input );

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    inputPoint.connect( analyserNode );

    // core of the analysis:
    // var freqByteData = new Uint8Array(analyserNode.frequencyBinCount);
    // repeated step -
    // analyserNode.getByteFrequencyData(freqByteData);


    audioRecorder = new Recorder( inputPoint );

    zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0.0;
    inputPoint.connect( zeroGain );
    zeroGain.connect( audioContext.destination );
    toggleRecording();
   
    // TODO visual feedback for recording can be done if we use the analysers
    //updateAnalysers();
}

function initAudio(lat, lng) {
        latitude = lat;
        longitude = lng;
        if (!navigator.getUserMedia)
            navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        if (!navigator.cancelAnimationFrame)
            navigator.cancelAnimationFrame = navigator.webkitCancelAnimationFrame || navigator.mozCancelAnimationFrame;
        if (!navigator.requestAnimationFrame)
            navigator.requestAnimationFrame = navigator.webkitRequestAnimationFrame || navigator.mozRequestAnimationFrame;

    navigator.getUserMedia({audio:true}, gotStream, function(e) {
            alert('Error getting audio');
            console.log(e);
        });
}

//window.addEventListener('load', initAudio );
