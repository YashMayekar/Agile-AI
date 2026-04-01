{
  "res": "THIS CONTAINS A DESCRIPTION ABOUT THE ACTION STEPS OR JUST A RESPONSE FROM THE LLM",
  "actions": [
    {
      "type": "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG",
      "target": "CLI/SYS:LOCATION OF THE FILE" | "NAME OF THE AGENT",
      "content": "ACTUAL CONTENT TO BE WRITEN"
    },
    {
      "type": "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG",
      "target": "CLI/SYS:LOCATION OF THE FILE" | "NAME OF THE AGENT",
      "content": "ACTUAL CONTENT TO BE WRITEN"
    },
    ...
  ]
}

Here the variable means,
1. res - it can be a normal response from the user, like "Hello, how are you" or a description of the bellow steps. In the just normal response case, no action variable is generated.
2. actions - can contain single or multiple actions based on the requirement.

Inside actions variable,
1. type - identifies the type of action, like read, write, update, delete, switch-agent.
2. target - this variable may contian one of these three things, 2 locations or 1 agent name. The two location can be dedicated to a location in client side denoted by prefix 'CLI:' then address+filename, or for the system side denoted by "SYS:" then the address+filename.
3. content - this variable has the contents to be written at the target location.

This action variable may exist or may not exist depending upon the response.


Example:

# for just a single response:
{
  "res":"Hello, How are you!!!"
}

# for read a document or file from the client side:
{
  "res": "Reading the chatbot.ts",
  "actions": [
    {
      "type": "READ",
      "target": "CLI:src\\bots\\chatbot.ts",
    },
  ]
}

# for read a multiple document or file from the client side:
{
  "res": "Reading the chatbot.ts and the prompt.txt",
  "actions": [
    {
      "type": "READ",
      "target": "CLI:src\\bots\\chatbot.ts",
    },
    {
      "type": "READ",
      "target": "CLI:src\\bots\\prompt.txt",
    },
  ]
}

# for read a document or file from the system side:
{
  "res": "Reading the prd.md",
  "actions": [
    {
      "type": "READ",
      "target": "SYS:src\\docs\\prd.md",
    },
  ]
}

# for read a multiple document or file from the system side:
{
  "res": "Reading the prd.md and the project-brief.md",
  "actions": [
    {
      "type": "READ",
      "target": "SYS:src\\docs\\prd.md",
    },
    {
      "type": "READ",
      "target": "SYS:src\\docs\\project-brief.md",
    },
  ]
}


# for creating a document or file on the client side:
{
  "res": "Creating main.py",
  "actions": [
    {
      "type": "WRITE",
      "target": "CLI:src\\main.py",
      "content":"print("Hello World!")"
    },
  ]
}

# for creating multiple document or file on the client side:
{
  "res": "Creating main.py and server.py",
  "actions": [
    {
      "type": "WRITE",
      "target": "CLI:src\\main.py",
      "content":"print("Hello World!")"
    },
    {
      "type": "WRITE",
      "target": "CLI:src\\server.py",
      "content":"import Fastapi\napp = Fastapi()"
    },
  ]
}

# for creating a document or file on the server side:
{
  "res": "Creating architecture.md",
  "actions": [
    {
      "type": "WRITE",
      "target": "SYS:src\\docs\\architecture.md",
      "content":"#architecture.md"
    },
  ]
}

# for creating multiple document or file on the client side:
{
  "res": "Creating architecture.md and project-brief.md",
  "actions": [
    {
      "type": "WRITE",
      "target": "SYS:src\\docs\\architecture.md",
      "content":"#architecture.md"
    },
    {
      "type": "WRITE",
      "target": "SYS:src\\docs\\project-brief.md",
      "content":"#project-brief.md"
    },
  ]
}

# for updating a document or file on the client side:
{
  "res": "updating main.py",
  "actions": [
    {
      "type": "UPDATE",
      "target": "CLI:src\\main.py",
      "content":"print("My name is Jason!")"
    },
  ]
}
# for updating multiple document or file on the client side:
{
  "res": "Updating main.py and server.py",
  "actions": [
    {
      "type": "UPDATE",
      "target": "CLI:src\\main.py",
      "content":"print("Hello World!")"
    },
    {
      "type": "UPDATE",
      "target": "CLI:src\\server.py",
      "content":"import Fastapi\napp = Fastapi()"
    },
  ]
}

# for updating a document or file on the server side:
{
  "res": "updating architecture.md",
  "actions": [
    {
      "type": "UPDATE",
      "target": "SYS:src\\docs\\architecture.md",
      "content":"#architecture.md"
    },
  ]
}

# for updating multiple document or file on the client side:
{
  "res": "updating architecture.md and project-brief.md",
  "actions": [
    {
      "type": "UPDATE",
      "target": "SYS:src\\docs\\architecture.md",
      "content":"#architecture.md"
    },
    {
      "type": "UPDATE",
      "target": "SYS:src\\docs\\project-brief.md",
      "content":"#project-brief.md"
    },
  ]
}

# for deleting a document or file on the client side:
{
  "res": "deleting main.py",
  "actions": [
    {
      "type": "DELETE",
      "target": "CLI:src\\main.py",
      "content":"print("My name is Jason!")"
    },
  ]
}
# for deleting multiple document or file on the client side:
{
  "res": "deleting main.py and server.py",
  "actions": [
    {
      "type": "DELETE",
      "target": "CLI:src\\main.py",
      "content":"print("Hello World!")"
    },
    {
      "type": "DELETE",
      "target": "CLI:src\\server.py",
      "content":"import Fastapi\napp = Fastapi()"
    },
  ]
}

# for deleting a document or file on the server side:
{
  "res": "deleting architecture.md",
  "actions": [
    {
      "type": "DELETE",
      "target": "SYS:src\\docs\\architecture.md",
      "content":"#architecture.md"
    },
  ]
}

# for deleting multiple document or file on the client side:
{
  "res": "deleting architecture.md and project-brief.md",
  "actions": [
    {
      "type": "DELETE",
      "target": "SYS:src\\docs\\architecture.md",
      "content":"#architecture.md"
    },
    {
      "type": "DELETE",
      "target": "SYS:src\\docs\\project-brief.md",
      "content":"#project-brief.md"
    },
  ]
}

# for switing agent:
{
  "res": "Switching from orchestrator to analyst",
  "actions": [
    {
      "type": "SWITCH-AG",
      "target": "analyst",
    },
  ]
}
