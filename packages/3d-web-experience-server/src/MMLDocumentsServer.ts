import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { EditableNetworkedDOM, LocalObservableDOMFactory } from "@mml-io/networked-dom-server";
import { watch, FSWatcher } from "chokidar";
import micromatch from "micromatch";
import WebSocket from "ws";

const getMmlDocumentContent = (documentPath: string) => {
  return fs.readFileSync(documentPath, { encoding: "utf8", flag: "r" });
};

export class MMLDocumentsServer {
  private documents = new Map<
    string,
    {
      documentPath: string;
      document: EditableNetworkedDOM;
      // The connections to this document, closed when its file is removed
      webSockets: Set<WebSocket>;
    }
  >();
  private disposed = false;
  private watcher: FSWatcher;
  private watchPattern: string;

  constructor(
    private directory: string,
    watchPattern: string,
  ) {
    this.watchPattern = watchPattern;
    this.watch();
  }

  public dispose() {
    this.disposed = true;
    for (const { document } of this.documents.values()) {
      document.dispose();
    }
    this.documents.clear();
    this.watcher.close();
  }

  public handle(filename: string, ws: WebSocket) {
    const entry = this.documents.get(filename);
    if (!entry) {
      ws.close();
      return;
    }

    const { document } = entry;
    document.addWebSocket(ws as any);
    entry.webSockets.add(ws);
    ws.on("close", () => {
      entry.webSockets.delete(ws);
      // The document may have been removed (and disposed) since this connection was made, in which case it no longer
      // knows the connection and removing it would throw
      if (!this.disposed && this.documents.get(filename) === entry) {
        document.removeWebSocket(ws as any);
      }
    });
  }

  private watch() {
    this.watcher = watch(this.directory, {
      ignoreInitial: false,
      ignored: (checkPath, stats) => {
        if (!stats || !stats.isFile()) {
          return false;
        }
        return !micromatch.isMatch(checkPath, this.watchPattern);
      },
      persistent: true,
    });
    this.watcher
      .on("add", (fullPath, stats) => {
        if (!stats || !stats.isFile()) {
          return;
        }
        const relativePath = path.relative(this.directory, fullPath);
        console.log(`MML Document '${relativePath}' has been added`);
        const contents = getMmlDocumentContent(fullPath);
        const document = new EditableNetworkedDOM(
          url.pathToFileURL(fullPath).toString(),
          LocalObservableDOMFactory,
        );
        document.load(contents);

        const currentData = {
          documentPath: fullPath,
          document,
          webSockets: new Set<WebSocket>(),
        };
        this.documents.set(relativePath, currentData);
      })
      .on("change", (fullPath) => {
        const relativePath = path.relative(this.directory, fullPath);
        console.log(`MML Document '${relativePath}' has been changed`);
        const contents = getMmlDocumentContent(fullPath);
        const documentState = this.documents.get(relativePath);
        if (!documentState) {
          console.error(`MML Document '${relativePath}' not found`);
          return;
        }
        documentState.document.load(contents);
      })
      .on("unlink", (fullPath) => {
        const relativePath = path.relative(this.directory, fullPath);
        console.log(`MML Document '${relativePath}' has been removed`);
        const documentState = this.documents.get(relativePath);
        if (!documentState) {
          console.error(`MML Document '${relativePath}' not found`);
          return;
        }
        this.documents.delete(relativePath);
        // Close the connections so that clients reconnect (for example if the file is added again)
        for (const ws of documentState.webSockets) {
          ws.close();
        }
        documentState.webSockets.clear();
        documentState.document.dispose();
      })
      .on("error", (error) => {
        console.error("Error whilst watching directory", error);
      });
  }
}
