"use strict";
const $ = selector => document.querySelector(selector);
function clean(value){return String(value||"").replace(/\r/g,"").trim()}
function key(value){return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function sentences(value){return clean(value).split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean)}
function similar(a,b){const x=key(a),y=key(b);if(!x||!y)return false;if(x===y||x.includes(y)||y.includes(x))return true;const A=new Set(x.split(" ").filter(w=>w.length>2)),B=new Set(y.split(" ").filter(w=>w.length>2));let n=0;for(const w of A)if(B.has(w))n++;return A.size&&B.size?n/(A.size+B.size-n)>=.78:false}
function dedupeTree(nodes,seen=[]){return (nodes||[]).map(node=>{const summary=sentences(node.summary);const content=sentences(node.content).filter(line=>!summary.some(old=>similar(line,old))&&!seen.some(old=>similar(line,old))).join(" ");const keptSummary=summary.filter(line=>!seen.some(old=>similar(line,old))).join(" ");const local=[...seen,...sentences(keptSummary),...sentences(content)];const examples=(node.examples||[]).filter(example=>!sentences(example).some(line=>local.some(old=>similar(line,old))));local.push(...examples.flatMap(sentences));const children=dedupeTree(node.children||node.key_points||node.keyPoints||[],local);seen.push(...sentences(keptSummary),...sentences(content));return {...node,summary:keptSummary,content,examples,children}})}
function appendText(parent,tag,value,className){
  if(!value)return null;
  const el=document.createElement(tag); if(className)el.className=className;
  el.textContent=value;parent.append(el);return el;
}
function renderNode(node,index,depth=0){
  const card=document.createElement("article");card.className=depth?"shared-child":"shared-card";
  appendText(card,"div",depth?"DEEPER CONCEPT · LEVEL "+(depth+1):"STEP "+String(index+1).padStart(2,"0"),"shared-index");
  appendText(card,depth?"h3":"h2",node.title||"Learning concept");
  const content=clean(node.content);
  const summary=clean(node.summary);
  if(summary && !(norm(content).includes(norm(summary))))appendText(card,"p",summary);
  appendText(card,"p",content);
  const examples=Array.isArray(node.examples)?node.examples:[];
  examples.forEach(example=>appendText(card,"p",clean(example)));
  const children=node.children||node.key_points||node.keyPoints||[];
  if(children.length){
    const group=document.createElement("div");group.className="shared-children";
    children.forEach((child,i)=>group.append(renderNode(child,i,depth+1)));
    card.append(group);
  }
  return card;
}
async function load(){
  const token=new URLSearchParams(location.search).get("token") || location.pathname.split("/")[2];
  if(!token||!/^[A-Za-z0-9_-]{40,60}$/.test(token)){ $("#sharedTitle").textContent="This shared roll link is invalid.";$("#sharedIntro").textContent="Ask the person who shared it to create a new link.";$("#sharedStatus").textContent="";return; }
  try{
    const response=await fetch("/api/shared/"+encodeURIComponent(token),{cache:"no-store",credentials:"omit"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"This shared roll is unavailable.");
    const journey=data.journey;
    $("#sharedTitle").textContent=journey.title||journey.query||"Shared learning roll";
    $("#sharedIntro").textContent=clean(journey.introduction);
    const grid=$("#sharedGrid");grid.replaceChildren();
    dedupeTree(journey.stages||[]).forEach((node,index)=>grid.append(renderNode(node,index)));
    $("#sharedStatus").textContent=grid.children.length?"This is a read-only view of the learning roll.":"This roll has no learning steps to display.";
  }catch(error){
    $("#sharedTitle").textContent="We couldn't open this roll.";
    $("#sharedIntro").textContent=error.message;
    $("#sharedStatus").textContent="The owner may have deleted the roll or its sharing link may no longer be available.";
  }
}
load();