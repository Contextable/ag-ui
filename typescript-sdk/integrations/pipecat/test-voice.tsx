import React from "react";
import { PipecatVoice } from "./src/voice";

const TestVoice = () => {
  return (
    <PipecatVoice 
      config={{ 
        websocketUrl: "ws://localhost:7860",
        timeout: 30000
      }}
    >
      {(controls) => (
        <div>
          <button onClick={controls.connect}>Connect</button>
          <pre>{JSON.stringify(controls.state, null, 2)}</pre>
        </div>
      )}
    </PipecatVoice>
  );
};

export default TestVoice;