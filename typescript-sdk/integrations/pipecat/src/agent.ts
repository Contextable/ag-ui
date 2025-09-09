"use client";

import { HttpAgent } from "@ag-ui/client";
import { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { PipecatAgentConfig } from "./types";
import { Observable } from "rxjs";  
import { tap } from "rxjs/operators";  
import { transformHttpEventStream } from "@ag-ui/client";
import { runHttpRequest} from "@ag-ui/client";
import { HttpEvent, HttpEventType } from "@ag-ui/client/src/run/http-request";  

export class PipecatAgent extends HttpAgent {
  constructor(config: PipecatAgentConfig) {
    // Convert PipecatAgentConfig to HttpAgentConfig for the base class
    super({
      url: config.agUIEndpoint,
      headers: config.authHeaders,
    });
  }

  protected requestInit(input: RunAgentInput): RequestInit {
    return {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input),
      signal: this.abortController.signal,
    };
  }

  public run(input: RunAgentInput): Observable<BaseEvent> {  
    console.log('PipecatAgent: Starting run with input:', input);  
    
    // Use the standard HttpAgent implementation to avoid Observable pipeline issues
    return super.run(input).pipe(  
      tap((event) => {  
        console.log('PipecatAgent: Parsed event:', event);  
          
        if (event.type.startsWith('TOOL_CALL_')) {  
          console.log('PipecatAgent: Tool event detected:', event);  
        }  
      })  
    );  
  }

  // The run method is inherited from HttpAgent, which handles:
  // 1. HTTP POST to this.url (config.agUIEndpoint) 
  // 2. SSE stream processing
  // 3. Event transformation using AG-UI SDK event types
  // No need to override unless we need custom behavior
}