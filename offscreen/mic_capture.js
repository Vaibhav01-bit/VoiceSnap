navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
        console.log("Mic capture successful within iframe scope.");
        // We keep the stream alive
        window.voiceStream = stream;
    })
    .catch(err => {
        console.error("Mic capture failed in iframe scope:", err);
    });
