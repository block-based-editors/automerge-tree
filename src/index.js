import * as Automerge from "@automerge/automerge"
import * as Blockly from "blockly"
import { Events } from "blockly"

let docId = window.location.hash.replace(/^#/, '')
let channel = new BroadcastChannel(docId)
let doc = Automerge.init()

// render the whole state of all blocks
function render(doc) 
{
  var history = Automerge.getHistory(doc)
  
  // no Events.disable() as this will disable events for all workspaces and mirrorEvents will not render
  Events.setGroup("my_events") // TODO needs fix from Neil (#6827)


    // clear will send a lot of delete events :-(
  primaryWorkspace.clear()

  if (doc.blocks)
  {
    // make the block refer to each other again (next etc filled with block instead of id only)
    for (const [block_id, updated_block] of Object.entries(doc.blocks))
    {
      inject_blocks(updated_block, doc.blocks)
    }
    // render only the topblocks (childern are rendered by the parent)
    // top_blocks do not have any next or input pointing to them
    var children_ids = new Set()
    Object.values(doc.blocks).map(block => {
      if (block.next) 
      { 
        children_ids.add(block.next.block.id)
      }
      if (block.inputs)
      {
        Object.values(block.inputs).map(input => {
          if (input.block)
          {
            children_ids.add(input.block.id)
          }
        })
      }
    })

    var all_blocks_ids = Object.values(doc.blocks).map(block => block.id)
    var top_blocks_ids = all_blocks_ids.filter(block_id => !children_ids.has(block_id))

    for (var i=0;i<top_blocks_ids.length;i++)
    {
      Blockly.serialization.blocks.append(doc.blocks[top_blocks_ids[i]], primaryWorkspace, {recordUndo:false})
    }
  }
  Events.setGroup(false)
}

// couple of properties that need to be set at the same time
var temp_x;
var temp_y;

var temp_type;
var temp_id


// handles one change in the state 
function patchCallback(change)
{
  if (change.value === {})
  {
    return
  }
  if(change.action=='put')
  {
    // path[0] = 'blocks' always
    // path = ['blocks', 'block_id', 'x']
    if (change.path.length==3)
    {
      // property change
      var block_id = change.path[1]
      var property = change.path[2]
      var value = change.value
      if (property=='x') temp_x=value;
      if (property=='y') temp_y=value;
      if (property=='type') temp_type=value;
      if (property=='id') temp_id=value;

      // wait until both values are in
      if (temp_x!=null && temp_y!=null)
      {
        var block = primaryWorkspace.getBlockById(block_id)
        if(block)
        {
          var coordinate = block.getRelativeToSurfaceXY()
          if (temp_x-coordinate.x!=0 || temp_y-coordinate.y!=0)
          {
            if(!block.getParent())
            {
              block.moveBy( temp_x-coordinate.x, temp_y-coordinate.y) 
            }
            else
            {
              console.log("Block still has parent " + block.type + ':' + block.getParent().type)
            }
          }
        }
        temp_x=null;
        temp_y=null;
      }
      // wait until type and id are in, than it is possible to create a block
      if (temp_type!=null && temp_id!=null)
      {
        var block = primaryWorkspace.getBlockById(temp_id)
        if (!block)
        {
          Blockly.serialization.blocks.append({id:temp_id, type:temp_type}, primaryWorkspace, false)
        }
        temp_type=null;
        temp_id=null;
      }
    }
    if (change.path.length==4)
    {
      // field change
      // path = ['blocks', 'block_id', 'fields','key']
      var block_id = change.path[1]
      var property = change.path[2]
      if (property=='fields')
      {
        var key = change.path[3]
        var block = primaryWorkspace.getBlockById(block_id)
        if(block) // block may not yet exist
        {
          block.setFieldValue(change.value, key) 
        }
      }
    }
    if (change.path.length==5)
    {
        // path = ['blocks', 'block_id', 'next','block','id']
        // next block change
        var block_id = change.path[1]
        var property = change.path[2]
        if (property=='next')
        { 
          var next_block_id = change.value
          var block = primaryWorkspace.getBlockById(block_id)
          var next_block = primaryWorkspace.getBlockById(next_block_id)
          var connection = block.nextConnection;
          next_block.previousConnection.connect(connection);
          
        }
    }
    if (change.path.length==6)
    {
      // path = ['blocks', 'block_id', 'inputs','KEY', 'block','id']
      // input change
      var block_id = change.path[1]
      var property = change.path[2]
      if (property=='inputs')
      {
        var key = change.path[3]
        var child_id = change.value
        var block = primaryWorkspace.getBlockById(block_id)
        var child = primaryWorkspace.getBlockById(child_id)
        var connection = block.getInput(key).connection;
        if (child.previousConnection)
        {
          child.previousConnection.connect(connection);
        }
        else if (child.outputConnection)
        {
          child.outputConnection.connect(connection);
        }
      }
    }
  }

  if(change.action=='del')
  {
    if (change.path.length==2)
    {
      // block dispose
      // path = ['blocks', 'block_id'] 
      var block_id = change.path[1]
      var block = primaryWorkspace.getBlockById(block_id)
      // block could already be disposed by his parent dispose
      if(block) 
      {
        block.dispose()
      }
    }
    // path = ['blocks', 'block_id', 'next']
    if (change.path.length==3)
    {
      // disconnect from the next block
      var block_id = change.path[1]
      var property = change.path[2]
      if(property=='next')
      {
        var block = primaryWorkspace.getBlockById(block_id)
        var connection = block.nextConnection;
        connection.disconnect()
      }

    }
    // path = ['blocks', 'block_id', 'inputs', 'KEY']
    if (change.path.length==4)
    {
      // disconnect an input
      var block_id = change.path[1]
      var property = change.path[2]
      if(property=='inputs')
      {
        var key = change.path[3]
        var block = primaryWorkspace.getBlockById(block_id)
        var connection = block.getInput(key).connection;
        connection.disconnect()
      }
    }
  }
}

channel.onmessage = (ev) => {
    let value = document.querySelector('input[name="receive_from_remote"]:checked').value;
    if (value=='receive_from_remote_on')
    {
      //let newDoc = Automerge.merge(doc, Automerge.load(ev.data.change))
      // patchCallback will receive a callback per every change in the json
      //let [newDoc, patch] = Automerge.applyChanges(doc, ev.data.changes, {patchCallback:patchCallback})
      //let [newDoc, patch] = Automerge.applyChanges(doc, ev.data.changes)
      let remoteDoc = Automerge.load(ev.data.binary)
      let newDoc = Automerge.merge(doc, remoteDoc)
      doc = newDoc
      // newDoc contains the whole state of the workspace (in merged format)
      // render only renders new blocks, no change that are handled by the patchCallback
      render(newDoc)
    }
}

async function start()
{
    let localCopy = await localforage.getItem(docId)
    if (localCopy) {
        let newDoc = Automerge.merge(doc, Automerge.load(localCopy))
        doc = newDoc
        render(newDoc)    
    } 
}

function saveToRemote(docId, binary) 
{
  fetch(`http://localhost:5000/${docId}`, {
    body: binary,
    method: "post",
    headers: {
      "Content-Type": "application/octet-stream",
    }
  }).catch(err => console.log(err))
}

// 
function updateDoc(newDoc) 
{
  let binary = Automerge.save(newDoc)
  localforage.setItem(docId, binary).catch(err => console.log(err))
  let actorId = Automerge.getActorId(doc)
  doc = newDoc
  
  let value = document.querySelector('input[name="sync_to_remote"]:checked').value;
  if (value=='sync_to_remote_on')
  {  
    //let changes = Automerge.getChanges(doc, newDoc)
    //channel.postMessage({actorId, changes})
    channel.postMessage({actorId, binary})
    //saveToRemote(docId, binary)
  }
}

async function loadFromRemote(docId) {
    const response = await fetch(`http://localhost:5000/${docId}`)
    if (response.status !== 200) throw new Error('No saved draft for doc with id=' + docId)
    const respbuffer = await response.arrayBuffer()
    if (respbuffer.byteLength === 0) throw new Error('No saved draft for doc with id=' + docId)
    const view = new Uint8Array(respbuffer)
    let newDoc = Automerge.merge(doc, Automerge.load(view))
    doc = newDoc
    render(newDoc)
}

function addEvent(event) 
{
  
  // handles a blockly gui event and updates 
  // only the those properties / connection / creation / deletion
  // in the automerge state document
  let comment = JSON.stringify(event.toJson())
  var oldDoc = doc;
  let newDoc = Automerge.change(oldDoc, comment , doc => 
  {
    // create the block placeholder if not exist
    if (!doc.blocks)
    {
      doc.blocks = {}
    }

    // try to change as little as possible depending on the event received
    // this will give the least chance on a collision 
    if(event.type=='delete')
    {
      // multiple blocks can be delete in one event
      for (var i=0;i<event.ids.length;i++)
      {
        delete doc.blocks[event.ids[i]]
      }
    }
    else if(event.type=='create')
    {
      var main_block = primaryWorkspace.getBlockById(event.blockId)
      var decentants = main_block.getDescendants(true)

      for(var i=decentants.length-1;i>=0;i--)
      {
        var block = decentants[i]
        var block_json = mergeable_block(block)
        
        setPrototype(block_json)
        doc.blocks[block.id] = block_json
      } 
    }

    if (event.type=='change')
    {
      if(event.element=='field')
      {
        doc.blocks[event.blockId].fields[event.name] = event.newValue;
      }
      else
      {
        not_supported_element_change
      }
    }
    if (event.type=='move')
    {
      // move are move of blocks but also move from and to connections

      // oldInputName && oldParentId -> remove of input
      if (event.oldInputName) // old input or old parent?
      {
        delete doc.blocks[event.oldParentId].inputs[event.oldInputName]
      }
      else if (event.oldParentId) // only oldParentId -> remove of next
      {
        delete doc.blocks[event.oldParentId].next
      }  

      if(event.newCoordinate)
      {
        // delete can come before the move
        if (doc.blocks[event.blockId])
        {
          doc.blocks[event.blockId].x = event.newCoordinate.x;
          doc.blocks[event.blockId].y = event.newCoordinate.y;
        }
      }
      else // new input or new parent
      {
        if(event.newInputName)
        {
          if (!doc.blocks[event.newParentId].inputs)
          {
            doc.blocks[event.newParentId].inputs = {} // inputs are only serialized when blocks are connected
          } 
          doc.blocks[event.newParentId].inputs[event.newInputName] = { block: {id: event.blockId}}
          // remove the x and y as this block is connected now and
          // the position is determined by the parent 
          delete doc.blocks[event.blockId].x
          delete doc.blocks[event.blockId].y
        }
        else // we are a new next block -> change the next of our newParent
        {
          doc.blocks[event.newParentId].next = { block: {id: event.blockId}}
          // remove the x and y as this block is connected now and
          // the position is determined by the parent 
          delete doc.blocks[event.blockId].x
          delete doc.blocks[event.blockId].y
        }
      }   
    }
  }) // end of function
  // send to newDoc arround
  updateDoc(newDoc)
}

// replace the blocks with there ids only
// in this way blocks remove the nesting
function replace_blocks(obj)
{
  var properties = Object.getOwnPropertyNames(obj)
  for (var j=0; j<properties.length;j++)
  {
    if (properties[j]=='block')
    {
      // remove the block but keep the id
      if (obj.block)
      {
        var id = obj.block.id
        delete obj.block
        obj.block = { "id": id }
      }
      else // block property but now id, clean it up anyway
      {
        delete obj.block
      }
    } 
    else if (typeof(obj[properties[j]])=='object')
    {
      replace_blocks(obj[properties[j]])
    }
  }
}

// replace the ids back with the blocks so 
// the blocks are nested again
// Blockly.serialization works again
function inject_blocks(obj, saved_blocks)
// in place injectioon
{
    var properties = Object.getOwnPropertyNames(obj)
    for (var j=0; j<properties.length;j++)
    {
        if (properties[j]=='block')
        {
          obj.block = saved_blocks[obj.block.id]
        }
        // kind of strange that the type can be object and the value null 
        else if (typeof(obj[properties[j]])=='object' && obj[properties[j]]!=null)
        {
          inject_blocks(obj[properties[j]], saved_blocks)
        }
        else
        {
          // value, no need to process
        }
    }
}

// create serialized version of the block with the 
// blocks replaced by their ids (so no nesting anymore)
function mergeable_block(block)
// return the json
{
  // no coordinates needed when a block has a parent
  var json_obj = Blockly.serialization.blocks.save(block, {addCoordinates: !block.getParent(), 
    addInputBlocks: true, 
    addNextBlocks: true, 
    doFullSerialization: true})
  
  replace_blocks(json_obj)
  return json_obj
}

var toolbox = 
{
  "kind": "flyoutToolbox",
  "contents": [
    {
      "kind": "block",
      "type": "controls_if"
    },
    {
      "kind": "block",
      "type": "logic_compare"
    },
    {
      "kind": "block",
      "type": "controls_repeat_ext"
    },
    {
      "kind": "block",
      "type": "math_number",
      "fields": {
        NUM: 123
      }
    },
    {
      "kind": "block",
      "type": "math_arithmetic"
    },
    {
      "kind": "block",
      "type": "text"
    },
    {
      "kind": "block",
      "type": "text_print"
    },
    {
      "kind": "block",
      "type": "variables_get",
      "fields": {
        "VAR": {
          "name": "i"
        }
      }
    },
    {
      "kind": "block",
      "type": "variables_get",
      "fields": {
        "VAR": {
          "name": "j"
        }
      }
    },
    {
      "kind": "block",
      "type": "variables_get",
      "fields": {
        "VAR": {
          "name": "k"
        }
      }
    },
  ]
};

// Inject primary workspace. 
var primaryWorkspace = Blockly.inject('primaryDiv',
    {media: 'https://unpkg.com/blockly/media/',
      toolbox: toolbox});
// Inject secondary workspace.
var secondaryWorkspace = Blockly.inject('secondaryDiv',
    {media: 'https://unpkg.com/blockly/media/',
      readOnly: true});

//loadFromRemote(docId)
start();

// Listen to events on primary workspace.
primaryWorkspace.addChangeListener(mirrorEvent);

function mirrorEvent(primaryEvent) {
  
  if (primaryEvent.isUiEvent) {
    return;  // Don't mirror UI events.
  }
  
  if (primaryEvent.group !== "my_events") {
    addEvent(primaryEvent)
  }
  
  // local mirror
  // Convert event to JSON.  This could then be transmitted across the net.
  var json = primaryEvent.toJson();
  
  // Convert JSON back into an event, then execute it.
  var secondaryEvent = Blockly.Events.fromJson(json, secondaryWorkspace);
  secondaryEvent.run(true);
}

// function to make sure every object has a prototype 
// read function on it, needed for an issue in Automerge
function setPrototype(obj) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Set the prototype of the nested object
        Object.setPrototypeOf(obj[key], Object.prototype);
        // Recursively call the function on the nested object
        setPrototype(obj[key]);
      }
    }
  }
}







