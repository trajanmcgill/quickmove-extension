/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { AccountNode, FolderNode } from "../common/foldernode.js";
import { getValidatedDefaultFolders } from "../common/util.js";

const ALL_ACTIONS = ["move", "copy", "goto", "tag"];

function setup_localization() {
  for (let node of document.querySelectorAll("[data-l10n-id]")) {
    let l10nid = node.getAttribute("data-l10n-id");
    node.textContent = browser.i18n.getMessage(l10nid);
  }
}

function switchList(action) {
  let folderList = document.getElementById("folder-list");
  let tagList = document.getElementById("tag-list");

  if (action == "tag") {
    tagList.style.display = "revert-layer";
    folderList.style.display = "none";
    return tagList;
  } else {
    folderList.style.display = "revert-layer";
    tagList.style.display = "none";
    return folderList;
  }
}

async function load() {
  let { maxRecentFolders, showFolderPath, skipArchive, layout, defaultFolderSetting } = await browser.storage.local.get({ maxRecentFolders: 15, showFolderPath: true, layout: "auto", skipArchive: true, defaultFolderSetting: "recent" });

  if (layout == "wide" || (layout == "auto" && window.outerWidth > 1400)) {
    document.documentElement.removeAttribute("compact");
    document.getElementById("folder-list").removeAttribute("compact");
  }
  document.body.style.display = "revert-layer";

  setup_localization();

  let params = new URLSearchParams(window.location.search);

  let action = params.get("action") || "move";
  document.querySelector(`.action-buttons input[value="${action}"]`).checked = true;

  let actions = new Set(ALL_ACTIONS);

  for (let allowedAction of (params.get("allowed") || "move,copy,tag,goto").split(",")) {
    actions.delete(allowedAction);
  }

  for (let hideaction of actions.values()) {
    document.querySelector(`label[for='action-${hideaction}']`).remove();
    document.querySelector(`#action-${hideaction}`).remove();
  }

  if (ALL_ACTIONS.length - actions.size == 1) {
    document.querySelector(".action-buttons").classList.add("hide");
  }


  // Setup folder list
  let accounts = await browser.accounts.list();

  let [currentTab] = await browser.tabs.query({ currentWindow: true, active: true });

  if (currentTab) {
    let currentMessage = await browser.messageDisplay.getDisplayedMessage(currentTab.id);
    if (currentMessage) {
      let currentAccountId = currentMessage.folder.accountId;
      let currentAccountIndex = accounts.findIndex(account => account.id === currentAccountId);
      if (currentAccountIndex >= 0) {
        accounts.unshift(...accounts.splice(currentAccountIndex, 1));
      }
    }
  }

  let accountNodes = accounts.map(account => new AccountNode(account, skipArchive));
  let folders = accountNodes.reduce((acc, node) => acc.concat([...node]), []);
  let defaultFolders;

  if (defaultFolderSetting == "recent") {
    defaultFolders = FolderNode.fromList(await browser.quickmove.query({ recent: true, limit: maxRecentFolders, canFileMessages: true }), accountNodes);
  } else if (defaultFolderSetting == "specific") {
    defaultFolders = FolderNode.fromList(await getValidatedDefaultFolders(accountNodes), accountNodes);
  } else {
    defaultFolders = null;
  }

  let folderList = document.getElementById("folder-list");
  folderList.accounts = accounts;
  folderList.initItems(folders, defaultFolders, showFolderPath);
  folderList.ignoreFocus = true;
  folderList.addEventListener("item-selected", async (event) => {
    let operation = document.querySelector("input[name='action']:checked").value;

    if (operation == "move" || operation == "copy") {
      await browser.runtime.sendMessage({ action: "processSelectedMessages", folder: event.detail, operation: operation });
    } else if (operation == "goto") {
      let [tab] = await browser.tabs.query({ currentWindow: true, active: true });
      await browser.mailTabs.update(tab.id, { displayedFolder: event.detail });
    }
    window.close();
  });

  // Setup tag list
  let tags = await browser.messages.listTags();
  let tagList = document.getElementById("tag-list");
  tagList.ignoreFocus = true;
  tagList.initItems(tags, null);
  tagList.addEventListener("item-selected", async (event) => {
    await browser.runtime.sendMessage({ action: "processSelectedMessages", tag: event.detail.key, operation: "tag" });
    window.close();
  });

  document.querySelector(".action-buttons").addEventListener("click", (event) => {
    switchList(event.target.value).focusSearch();
  });

  document.body.addEventListener("mousemove", () => {
    folderList.ignoreFocus = false;
    tagList.ignoreFocus = false;
  }, { once: true });

  if (params.get("window") == "true") {
    browser.windows.update(browser.windows.WINDOW_ID_CURRENT, { width: document.body.clientWidth });
    document.getElementById("window-warning").classList.add("visible");
  }

  switchList(action).focusSearch();
}

function unload(event) {
  browser.runtime.sendMessage({ action: "focusThreadPane" }).catch(() => {});
}

function keydown(event) {
  if (event.key == "Escape") {
    window.close();
  } else if (event.key == "ArrowLeft" || event.key == "ArrowRight") {
    let params = new URLSearchParams(window.location.search);
    let sequence = (params.get("allowed") || "move,copy").split(",");
    let direction = event.key == "ArrowLeft" ? -1 : 1;
    if (getComputedStyle(document.documentElement).direction == "rtl") {
      direction *= -1;
    }

    let checked = document.querySelector(".action-buttons input:checked");
    let nextIdx = sequence.indexOf(checked.value) + direction;
    let action = sequence[Math.max(0, Math.min(nextIdx, sequence.length - 1))];
    document.querySelector(`.action-buttons input[value="${action}"]`).checked = true;

    switchList(action).focusSearch();
  }
}

window.addEventListener("keydown", keydown);
window.addEventListener("DOMContentLoaded", load, { once: true });
window.addEventListener("unload", unload, { once: true, capture: true });
