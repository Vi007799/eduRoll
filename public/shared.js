"use strict";
const $ = selector => document.querySelector(selector);
function clean(value){return String(value||"").replace(/\r/g,"").trim()}
function norm(value){return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function key(value){return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function sentences(value){return clean(value).split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean)}
function similar(a,b){const x=key(a),y=key(b);if(!x||!y)return false;if(x===y||x.includes(y)||y.includes(x))return true;const A=new Set(x.split(" ").filter(w=>w.length>2)),B=new Set(y.split(" ").filter(w=>w.length>2));let n=0;for(const w of A)if(B.has(w))n++;return A.size&&B.size?n/(A.size+B.size-n)>=.78:false}
function dedupeTree(nodes,seen=[]){return (nodes||[]).map(node=>{const summary=sentences(node.summary);const content=sentences(node.content).filter(line=>!summary.some(old=>similar(line,old))&&!seen.some(old=>similar(line,old))).join(" ");const keptSummary=summary.filter(line=>!seen.some(old=>similar(line,old))).join(" ");const local=[...seen,...sentences(keptSummary),...sentences(content)];const examples=(node.examples||[]).filter(example=>!sentences(example).some(line=>local.some(old=>similar(line,old))));local.push(...examples.flatMap(sentences));const children=dedupeTree(node.children||node.key_points||node.keyPoints||[],local);seen.push(...sentences(keptSummary),...sentences(content));return {...node,summary:keptSummary,content,examples,children}})}
function appendText(parent,tag,value,className){
  if(!value)return null;
  const el=document.createElement(tag); if(className)el.className=className;
  el.textContent=value;parent.append(el);return el;
}
let sharedJourney=null;
let branchStack=[];
function nodeChildren(node){return node.children||node.key_points||node.keyPoints||[]}
function renderNode(node,index,depth=0){
  const card=document.createElement("article");card.className=depth?"shared-child":"shared-card";
  appendText(card,"div",depth?"DEEPER CONCEPT · LEVEL "+(depth+1):"STEP "+String(index+1).padStart(2,"0"),"shared-index");
  appendText(card,depth?"h3":"h2",node.title||"Learning concept");
  const content=clean(node.content),summary=clean(node.summary);
  if(summary && !norm(content).includes(norm(summary)))appendText(card,"p",summary);
  appendText(card,"p",content);
  (Array.isArray(node.examples)?node.examples:[]).forEach(example=>appendText(card,"p",clean(example)));
  const children=nodeChildren(node);
  if(children.length){
    const button=document.createElement("button");button.type="button";button.className="shared-explore";button.textContent="Explore branch · "+children.length;
    button.addEventListener("click",()=>{branchStack.push(node.id);renderWorkspace()});
    card.append(button);
  }
  return card;
}
function findNode(id,nodes=sharedJourney.stages||[]){
 for(const node of nodes){if(node.id===id)return node;const found=findNode(id,nodeChildren(node));if(found)return found;}return null;
}
function renderWorkspace(){
 const workspace=$("#sharedWorkspace"),grid=$("#sharedWorkspaceGrid"),crumbs=$("#sharedBreadcrumbs");
 const node=branchStack.length?findNode(branchStack[branchStack.length-1]):null;
 if(!node){workspace.hidden=true;return;}
 workspace.hidden=false;crumbs.replaceChildren();
 const back=document.createElement("button");back.type="button";back.className="shared-back";back.textContent="← Back to previous branch";
 back.addEventListener("click",()=>{branchStack.pop();renderWorkspace()});crumbs.append(back);
 const title=document.createElement("h2");title.textContent=node.title;crumbs.append(title);
 grid.replaceChildren();
 nodeChildren(node).forEach((child,index)=>grid.append(renderNode(child,index,branchStack.length)));
 workspace.scrollIntoView({behavior:"smooth",block:"start"});
}
async function load(){
  const token=new URLSearchParams(location.search).get("token") || location.pathname.split("/")[2];
  if(!token||!/^[A-Za-z0-9_-]{40,60}$/.test(token)){ $("#sharedTitle").textContent="This shared roll link is invalid.";$("#sharedIntro").textContent="Ask the person who shared it to create a new link.";$("#sharedStatus").textContent="";return; }
  try{
    const authResponse=await fetch("/api/auth/me",{cache:"no-store",credentials:"same-origin"});
    const auth=await authResponse.json().catch(()=>({}));
    if(!auth.user){location.replace("/?signin=1&returnTo="+encodeURIComponent("/share/"+token));return;}
    const response=await fetch("/api/shared/"+encodeURIComponent(token),{cache:"no-store",credentials:"same-origin"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"This shared roll is unavailable.");
    const journey=data.journey; sharedJourney=journey; branchStack=[];
    $("#sharedTitle").textContent=journey.title||journey.query||"Shared learning roll";
    $("#sharedIntro").textContent=clean(journey.introduction);
    const grid=$("#sharedGrid");grid.replaceChildren();
    journey.stages=dedupeTree(journey.stages||[]); journey.stages.forEach((node,index)=>grid.append(renderNode(node,index)));
    $("#sharedStatus").textContent=grid.children.length?"This is a read-only view of the learning roll.":"This roll has no learning steps to display.";
  }catch(error){
    $("#sharedTitle").textContent="We couldn't open this roll.";
    $("#sharedIntro").textContent=error.message;
    $("#sharedStatus").textContent="The owner may have deleted the roll or its sharing link may no longer be available.";
  }
}
load();